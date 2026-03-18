import base64
from flask import Blueprint, request, jsonify
from utils.db import db_instance
from services.recommendation import get_recommendations
import uuid
import datetime

worker_bp = Blueprint('worker', __name__)

@worker_bp.route('/', methods=['GET'])
def get_workers():
    workers_col = db_instance.get_collection('workers')
    include_all = request.args.get('include_all') == '1'
    query = {} if include_all else {"availability": {"$ne": "Offline"}}
    workers = list(workers_col.find(query))
    # Clean up _id for JSON serializability if using Mongo
    for w in workers:
        if '_id' in w: w['_id'] = str(w['_id'])
    return jsonify(workers)

@worker_bp.route('/recommend', methods=['POST'])
def recommend():
    data = request.json
    lat = data.get('lat')
    lng = data.get('lng')
    category = data.get('category')
    
    workers_col = db_instance.get_collection('workers')
    workers = list(workers_col.find())
    for w in workers:
        if '_id' in w: w['_id'] = str(w['_id'])
        
    results = get_recommendations(lat, lng, workers, category)
    return jsonify(results)

@worker_bp.route('/profile/<email>', methods=['GET'])
def get_worker_profile(email):
    workers_col = db_instance.get_collection('workers')
    worker = workers_col.find_one({"email": email})
    if worker:
        if '_id' in worker: worker['_id'] = str(worker['_id'])
        return jsonify(worker)
    return jsonify({"error": "Worker not found"}), 404

@worker_bp.route('/register', methods=['POST'])
def register_worker():
    data = request.form
    files = request.files
    workers_col = db_instance.get_collection('workers')
    users_col = db_instance.get_collection('users')
    email = data.get('email')
    
    # Strictly check for existing partner
    existing_worker = workers_col.find_one({"email": email})
    if existing_worker:
        # Update only if it's already a worker
        availability = data.get('availability', existing_worker.get('availability', 'Available'))
        workers_col.update_one(
            {"email": email},
            {"$set": {
                "lat": float(data.get('lat', existing_worker.get('lat'))),
                "lng": float(data.get('lng', existing_worker.get('lng'))),
                "availability": availability,
                "status": 'Available' if availability != 'Offline' else 'Offline',
                "last_active": datetime.datetime.utcnow().isoformat()
            }}
        )
        worker = workers_col.find_one({"email": email})
        if '_id' in worker: worker['_id'] = str(worker['_id'])
        return jsonify({"message": "Location updated", "worker": worker})

    # Check if this email is already a Customer
    existing_user = users_col.find_one({"email": email})
    if existing_user and existing_user.get('role') == 'customer':
        return jsonify({"error": "This email is registered as a Customer and cannot be used for a Partner account."}), 403

    photo_url = 'https://via.placeholder.com/150'
    if 'photo' in files:
        photo = files['photo']
        if photo.filename != '':
            photo_bytes = photo.read()
            if photo_bytes:
                mime_type = photo.mimetype or 'image/jpeg'
                encoded_photo = base64.b64encode(photo_bytes).decode('utf-8')
                photo_url = f"data:{mime_type};base64,{encoded_photo}"

    new_worker = {
        "id": str(uuid.uuid4()),
        "name": data.get('name'),
        "email": data.get('email'),
        "skill": data.get('skill'),
        "phone": data.get('phone'),
        "experience": data.get('experience'),
        "bio": data.get('bio'),
        "status": data.get('status', 'Available'),
        "price": float(data.get('price', 0)),
        "rating": 5.0,
        "lat": float(data.get('lat', 28.6139)),
        "lng": float(data.get('lng', 77.2090)),
        "photo_url": photo_url,
        "reviews_count": 0,
        "availability": data.get('availability', 'Available')
    }
    
    workers_col.insert_one(new_worker)
    
    # Track role in main users collection
    db_instance.get_collection('users').update_one({"email": email}, {"$set": {"role": "partner"}})
        
    return jsonify({"message": "Worker registered successfully", "worker": new_worker})


@worker_bp.route('/availability', methods=['POST'])
def update_worker_availability():
    data = request.get_json(silent=True) or {}
    email = data.get('email')
    availability = data.get('availability', 'Available')
    if not email:
        return jsonify({"error": "email is required"}), 400

    workers_col = db_instance.get_collection('workers')
    worker = workers_col.find_one({"email": email})
    if not worker:
        return jsonify({"error": "Worker not found"}), 404

    workers_col.update_one(
        {"email": email},
        {"$set": {
            "availability": availability,
            "status": 'Available' if availability != 'Offline' else 'Offline',
            "last_active": datetime.datetime.utcnow().isoformat()
        }}
    )
    return jsonify({"message": "Availability updated", "availability": availability})
