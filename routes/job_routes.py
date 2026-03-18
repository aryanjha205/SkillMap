import datetime
import uuid

from flask import Blueprint, jsonify, request

from services.job_service import send_bill_email, send_receipt_email
from utils.db import db_instance

job_bp = Blueprint("job", __name__)

VALID_STATUSES = {"Pending", "Accepted", "On the Way", "Reached", "Completed", "Paid", "Cancelled"}


def _serialize_job(job):
    if not job:
        return None
    serialized = dict(job)
    if "_id" in serialized:
        serialized["_id"] = str(serialized["_id"])
    return serialized


@job_bp.route("/create", methods=["POST"])
def create_job():
    data = request.get_json(silent=True) or {}
    worker_id = data.get("worker_id")
    customer_email = data.get("customer_email")
    customer_location = data.get("customer_location") or {}

    if not worker_id or not customer_email:
        return jsonify({"error": "worker_id and customer_email are required"}), 400

    jobs_col = db_instance.get_collection("jobs")
    users_col = db_instance.get_collection("users")
    workers_col = db_instance.get_collection("workers")

    worker = workers_col.find_one({"id": worker_id})
    if not worker:
        return jsonify({"error": "Selected partner was not found"}), 404

    existing_job = jobs_col.find_one(
        {
            "worker_id": worker_id,
            "customer_email": customer_email,
            "status": {"$nin": ["Paid", "Cancelled"]},
        }
    )
    if existing_job:
        return jsonify(
            {
                "message": "You already have an active request with this partner",
                "job": _serialize_job(existing_job),
            }
        )

    customer = users_col.find_one({"email": customer_email}) if customer_email else None
    created_at = datetime.datetime.utcnow().isoformat()
    new_job = {
        "id": str(uuid.uuid4()),
        "worker_id": worker_id,
        "worker_name": worker.get("name"),
        "worker_email": worker.get("email"),
        "worker_phone": worker.get("phone"),
        "customer_email": customer_email,
        "customer_name": (customer or {}).get("name"),
        "customer_phone": (customer or {}).get("phone"),
        "customer_location": {
            "lat": customer_location.get("lat"),
            "lng": customer_location.get("lng"),
        },
        "status": "Pending",
        "skill": data.get("skill") or worker.get("skill"),
        "price": float(data.get("price") or worker.get("price") or 0),
        "created_at": created_at,
        "updated_at": created_at,
        "eta": "15 mins",
    }

    jobs_col.insert_one(new_job)
    return jsonify({"message": "Job request sent to partner", "job": _serialize_job(new_job)})


@job_bp.route("/customer/<email>", methods=["GET"])
def get_user_jobs(email):
    jobs_col = db_instance.get_collection("jobs")
    user_jobs = list(jobs_col.find({"customer_email": email}).sort("created_at", -1))
    return jsonify([_serialize_job(job) for job in user_jobs])


@job_bp.route("/worker/<worker_id>", methods=["GET"])
def get_worker_jobs(worker_id):
    jobs_col = db_instance.get_collection("jobs")
    worker_jobs = list(jobs_col.find({"worker_id": worker_id}).sort("created_at", -1))
    return jsonify([_serialize_job(job) for job in worker_jobs])


@job_bp.route("/update-status", methods=["POST"])
def update_status():
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    new_status = data.get("status")

    if not job_id or not new_status:
        return jsonify({"error": "job_id and status are required"}), 400
    if new_status not in VALID_STATUSES:
        return jsonify({"error": "Invalid status"}), 400

    jobs_col = db_instance.get_collection("jobs")
    job = jobs_col.find_one({"id": job_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    update_data = {
        "status": new_status,
        "updated_at": datetime.datetime.utcnow().isoformat(),
    }
    jobs_col.update_one({"id": job_id}, {"$set": update_data})
    job.update(update_data)

    mail_result = None
    worker_name = job.get("worker_name") or "Your Professional"
    if new_status == "Completed":
        mail_result = send_bill_email(job.get("customer_email"), worker_name, job)
        jobs_col.update_one(
            {"id": job_id},
            {"$set": {"bill_mail": mail_result, "bill_sent_at": datetime.datetime.utcnow().isoformat()}},
        )
    elif new_status == "Paid":
        mail_result = send_receipt_email(job.get("customer_email"), worker_name, job)
        jobs_col.update_one(
            {"id": job_id},
            {"$set": {"receipt_mail": mail_result, "receipt_sent_at": datetime.datetime.utcnow().isoformat()}},
        )

    response = {
        "message": f"Status updated to {new_status}",
        "job": _serialize_job(job),
    }
    if mail_result is not None:
        response["mail"] = mail_result
    return jsonify(response)


@job_bp.route("/cancel", methods=["POST"])
def cancel_job():
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400

    jobs_col = db_instance.get_collection("jobs")
    result = jobs_col.update_one(
        {"id": job_id, "status": "Pending"},
        {"$set": {"status": "Cancelled", "updated_at": datetime.datetime.utcnow().isoformat()}},
    )
    if result.matched_count == 0:
        return jsonify({"error": "Pending job not found"}), 404
    return jsonify({"message": "Job cancelled"})
