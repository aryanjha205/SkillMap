from flask import Blueprint, request, jsonify
from utils.db import db_instance
import datetime

admin_bp = Blueprint('admin', __name__)

@admin_bp.route('/stats', methods=['GET'])
def get_stats():
    users_col = db_instance.get_collection('users')
    workers_col = db_instance.get_collection('workers')
    jobs_col = db_instance.get_collection('jobs')
    
    total_users = users_col.count_documents({})
    total_workers = workers_col.count_documents({})
    total_jobs = jobs_col.count_documents({})
    
    # Calculate total earnings from Paid jobs
    paid_jobs = list(jobs_col.find({"status": "Paid"}))
    total_earnings = sum(float(job.get('price', 0)) for job in paid_jobs)
    
    return jsonify({
        "total_users": total_users,
        "total_workers": total_workers,
        "total_jobs": total_jobs,
        "total_earnings": total_earnings
    })

@admin_bp.route('/users', methods=['GET'])
def get_all_users():
    users_col = db_instance.get_collection('users')
    # Separate: Only show those who are NOT partners (includes customers and new accounts)
    users = list(users_col.find({"role": {"$ne": "partner"}}))
    for u in users:
        if '_id' in u: u['_id'] = str(u['_id'])
    return jsonify(users)

@admin_bp.route('/partners', methods=['GET'])
def get_all_partners():
    workers_col = db_instance.get_collection('workers')
    workers = list(workers_col.find())
    for w in workers:
        if '_id' in w: w['_id'] = str(w['_id'])
    return jsonify(workers)

@admin_bp.route('/jobs', methods=['GET'])
def get_all_jobs():
    jobs_col = db_instance.get_collection('jobs')
    jobs = list(jobs_col.find().sort('created_at', -1))
    for j in jobs:
        if '_id' in j: j['_id'] = str(j['_id'])
    return jsonify(jobs)

@admin_bp.route('/delete-user/<user_id>', methods=['DELETE'])
def delete_user(user_id):
    users_col = db_instance.get_collection('users')
    workers_col = db_instance.get_collection('workers')
    
    user = users_col.find_one({"id": user_id})
    if user:
        email = user.get('email')
        users_col.delete_one({"id": user_id})
        if email:
            workers_col.delete_one({"email": email})
            
    return jsonify({"message": "User and associated partner profile deleted"})

@admin_bp.route('/delete-worker/<worker_id>', methods=['DELETE'])
def delete_worker(worker_id):
    workers_col = db_instance.get_collection('workers')
    users_col = db_instance.get_collection('users')
    
    # Get the email first to delete from users as well
    worker = workers_col.find_one({"id": worker_id})
    if worker:
        email = worker.get('email')
        workers_col.delete_one({"id": worker_id})
        if email:
            users_col.delete_one({"email": email})
            
    return jsonify({"message": "Partner and associated account deleted"})
