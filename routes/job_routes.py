from flask import Blueprint, request, jsonify
from utils.db import db_instance
import uuid
import datetime

job_bp = Blueprint('job', __name__)

@job_bp.route('/create', methods=['POST'])
def create_job():
    data = request.json
    jobs_col = db_instance.get_collection('jobs')
    users_col = db_instance.get_collection('users')
    customer_email = data.get('customer_email')
    customer = users_col.find_one({"email": customer_email}) if customer_email else None
    
    new_job = {
        "id": str(uuid.uuid4()),
        "worker_id": data.get('worker_id'),
        "customer_email": customer_email,
        "customer_name": (customer or {}).get('name'),
        "customer_phone": (customer or {}).get('phone'),
        "customer_location": data.get('customer_location'),
        "status": "Pending",
        "skill": data.get('skill'),
        "price": data.get('price'),
        "created_at": datetime.datetime.utcnow().isoformat(),
        "eta": "15 mins"
    }
    
    jobs_col.insert_one(new_job)
    
    return jsonify({"message": "Job initiated", "job": new_job})

@job_bp.route('/customer/<email>', methods=['GET'])
def get_user_jobs(email):
    jobs_col = db_instance.get_collection('jobs')
    user_jobs = list(jobs_col.find({"customer_email": email}).sort('created_at', -1))
    
    # Process for JSON
    for job in user_jobs:
        if '_id' in job: job['_id'] = str(job['_id'])
        
    return jsonify(user_jobs)

@job_bp.route('/worker/<worker_id>', methods=['GET'])
def get_worker_jobs(worker_id):
    jobs_col = db_instance.get_collection('jobs')
    worker_jobs = list(jobs_col.find({"worker_id": worker_id}).sort('created_at', -1))
    
    for job in worker_jobs:
        if '_id' in job: job['_id'] = str(job['_id'])
        
    return jsonify(worker_jobs)

@job_bp.route('/update-status', methods=['POST'])
def update_status():
    data = request.json
    job_id = data.get('job_id')
    new_status = data.get('status')
    
    jobs_col = db_instance.get_collection('jobs')
    
    update_data = {"status": new_status}
    if new_status == "Paid":
        update_data["updated_at"] = datetime.datetime.utcnow().isoformat()
        
    jobs_col.update_one({"id": job_id}, {"$set": update_data})
    
    job = jobs_col.find_one({"id": job_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404
        
    if new_status == "Completed":
        from services.job_service import send_bill_email
        send_bill_email(job.get('customer_email'), "Your Professional", job)
    elif new_status == "Paid":
        from services.job_service import send_receipt_email
        send_receipt_email(job.get('customer_email'), "Your Professional", job)
        
    return jsonify({"message": f"Status updated to {new_status}"})
@job_bp.route('/cancel', methods=['POST'])
def cancel_job():
    data = request.json
    job_id = data.get('job_id')
    jobs_col = db_instance.get_collection('jobs')
    jobs_col.delete_one({"id": job_id, "status": "Pending"})
    return jsonify({"message": "Job cancelled"})
