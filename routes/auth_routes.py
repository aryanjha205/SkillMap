from flask import Blueprint, request, jsonify
from auth.auth_handler import generate_otp, send_otp_email, create_token
from utils.db import db_instance
import uuid
import datetime

auth_bp = Blueprint('auth', __name__)
otp_store = {} # Temporary in-memory store for OTPs. In prod, use Redis or DB.

def save_otp(email, otp):
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=10)
    try:
        otp_col = db_instance.get_collection('otp_codes')
        otp_col.update_one(
            {"email": email},
            {"$set": {"otp": otp, "expires_at": expires_at}},
            upsert=True
        )
        return True
    except Exception:
        otp_store[email] = {"otp": otp, "expires_at": expires_at}
        return False

def read_otp(email):
    now = datetime.datetime.utcnow()
    try:
        otp_col = db_instance.get_collection('otp_codes')
        record = otp_col.find_one({"email": email})
        if not record:
            return None
        expires_at = record.get("expires_at")
        if expires_at and expires_at < now:
            otp_col.delete_one({"email": email})
            return None
        return record.get("otp")
    except Exception:
        record = otp_store.get(email)
        if not record:
            return None
        if record.get("expires_at") and record["expires_at"] < now:
            otp_store.pop(email, None)
            return None
        return record.get("otp")

def clear_otp(email):
    try:
        otp_col = db_instance.get_collection('otp_codes')
        otp_col.delete_one({"email": email})
    except Exception:
        otp_store.pop(email, None)

@auth_bp.route('/send-otp', methods=['POST'])
def send_otp():
    data = request.json
    email = (data.get('email') or '').strip().lower()
    if not email:
        return jsonify({"error": "Email is required"}), 400
    
    otp = generate_otp()
    send_result = send_otp_email(email, otp)
    if send_result.get("success"):
        save_otp(email, otp)
        return jsonify({"message": "OTP sent successfully"})
    return jsonify({"error": send_result.get("error", "Failed to send OTP")}), 500

@auth_bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    email = (data.get('email') or '').strip().lower()
    otp = (data.get('otp') or '').strip()
    
    if read_otp(email) == otp:
        token = create_token(email)
        users_col = db_instance.get_collection('users')
        workers_col = db_instance.get_collection('workers')
        
        user = users_col.find_one({"email": email})
        worker = workers_col.find_one({"email": email})
        
        role = None
        has_profile = False
        
        if worker:
            role = 'partner'
            has_profile = True
            user_data = {
                "id": worker.get('id'),
                "name": worker.get('name'),
                "phone": worker.get('phone'),
                "role": "partner"
            }
        elif user:
            role = 'customer'
            has_profile = all(k in user for k in ['name', 'phone'])
            user_data = {
                "id": user.get('id'),
                "name": user.get('name'),
                "phone": user.get('phone'),
                "role": "customer"
            }
        else:
            # New user, no role yet
            user_id = str(uuid.uuid4())
            users_col.insert_one({"id": user_id, "email": email, "created_at": datetime.datetime.utcnow().isoformat()})
            user_data = {"id": user_id, "email": email}

        clear_otp(email)
        return jsonify({
            "token": token, 
            "email": email, 
            "has_profile": has_profile,
            "role": role,
            "user": user_data
        })
    
    return jsonify({"error": "Invalid OTP"}), 401

@auth_bp.route('/update-profile', methods=['POST'])
def update_profile():
    data = request.json
    email = data.get('email')
    users_col = db_instance.get_collection('users')
    workers_col = db_instance.get_collection('workers')

    # Ensure this email is not a partner
    if workers_col.find_one({"email": email}):
        return jsonify({"error": "This email is registered as a Partner and cannot be used for a Customer account."}), 403
    
    users_col.update_one(
        {"email": email},
        {"$set": {
            "name": data.get('name'),
            "phone": data.get('phone'),
            "role": "customer",
            "updated_at": datetime.datetime.utcnow().isoformat()
        }}
    )
    return jsonify({"message": "Profile updated"})

@auth_bp.route('/profile/<email>', methods=['GET'])
def get_profile(email):
    users_col = db_instance.get_collection('users')
    workers_col = db_instance.get_collection('workers')
    
    worker = workers_col.find_one({"email": email})
    if worker:
        if '_id' in worker: worker['_id'] = str(worker['_id'])
        worker['is_partner'] = True
        return jsonify(worker)
        
    user = users_col.find_one({"email": email})
    if user:
        if '_id' in user: user['_id'] = str(user['_id'])
        user['is_partner'] = False
        return jsonify(user)
        
    return jsonify({"error": "User not found"}), 404
