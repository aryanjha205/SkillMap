import datetime
import uuid

from flask import Blueprint, jsonify, request

from services.job_service import send_bill_email, send_receipt_email
from utils.db import db_instance

job_bp = Blueprint("job", __name__)

TERMINAL_STATUSES = {"Paid", "Cancelled", "Rejected", "Expired"}
ACTIVE_STATUSES = {"Pending", "Accepted", "On the Way", "Reached", "Completed"}
STATUS_PRIORITY = {
    "Accepted": 0,
    "On the Way": 1,
    "Reached": 2,
    "Completed": 3,
    "Pending": 4,
    "Rejected": 5,
    "Cancelled": 6,
    "Expired": 7,
    "Paid": 8,
}
VALID_STATUSES = ACTIVE_STATUSES | TERMINAL_STATUSES


def _utc_now():
    return datetime.datetime.utcnow().isoformat()


def _serialize_job(job):
    if not job:
        return None
    serialized = dict(job)
    if "_id" in serialized:
        serialized["_id"] = str(serialized["_id"])
    return serialized


def _active_customer_job(jobs):
    if not jobs:
        return None
    active_jobs = [job for job in jobs if job.get("status") in ACTIVE_STATUSES]
    if not active_jobs:
        return None
    return sorted(
        active_jobs,
        key=lambda job: (
            STATUS_PRIORITY.get(job.get("status"), 99),
            job.get("created_at", ""),
        ),
    )[0]


def _build_job(worker, customer, customer_email, payload, request_group, request_mode):
    created_at = _utc_now()
    customer_location = payload.get("customer_location") or {}
    return {
        "id": str(uuid.uuid4()),
        "request_group": request_group,
        "request_mode": request_mode,
        "worker_id": worker.get("id"),
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
        "skill": payload.get("skill") or worker.get("skill"),
        "price": float(payload.get("price") or worker.get("price") or 0),
        "created_at": created_at,
        "updated_at": created_at,
        "eta": "15 mins",
        "cancelled_by": None,
        "rejected_by": None,
    }


def _create_jobs_for_workers(workers, payload, customer, customer_email, request_mode):
    jobs_col = db_instance.get_collection("jobs")
    request_group = str(uuid.uuid4())
    jobs = [
        _build_job(worker, customer, customer_email, payload, request_group, request_mode)
        for worker in workers
    ]
    if jobs:
        jobs_col.insert_many(jobs)
    return jobs


@job_bp.route("/create", methods=["POST"])
def create_job():
    data = request.get_json(silent=True) or {}
    worker_id = data.get("worker_id")
    customer_email = data.get("customer_email")

    if not worker_id or not customer_email:
        return jsonify({"error": "worker_id and customer_email are required"}), 400

    jobs_col = db_instance.get_collection("jobs")
    users_col = db_instance.get_collection("users")
    workers_col = db_instance.get_collection("workers")

    existing_jobs = list(
        jobs_col.find(
            {
                "customer_email": customer_email,
                "status": {"$in": list(ACTIVE_STATUSES)},
            }
        ).sort("created_at", -1)
    )
    active_job = _active_customer_job(existing_jobs)
    if active_job:
        return jsonify(
            {
                "message": "You already have an active request",
                "job": _serialize_job(active_job),
            }
        )

    worker = workers_col.find_one({"id": worker_id})
    if not worker:
        return jsonify({"error": "Selected partner was not found"}), 404

    customer = users_col.find_one({"email": customer_email}) if customer_email else None
    jobs = _create_jobs_for_workers([worker], data, customer, customer_email, "direct")
    return jsonify({"message": "Request sent to partner", "job": _serialize_job(jobs[0])})


@job_bp.route("/broadcast", methods=["POST"])
def broadcast_job():
    data = request.get_json(silent=True) or {}
    customer_email = data.get("customer_email")
    worker_ids = data.get("worker_ids") or []
    skill = data.get("skill")

    if not customer_email:
        return jsonify({"error": "customer_email is required"}), 400

    jobs_col = db_instance.get_collection("jobs")
    users_col = db_instance.get_collection("users")
    workers_col = db_instance.get_collection("workers")

    existing_jobs = list(
        jobs_col.find(
            {
                "customer_email": customer_email,
                "status": {"$in": list(ACTIVE_STATUSES)},
            }
        ).sort("created_at", -1)
    )
    active_job = _active_customer_job(existing_jobs)
    if active_job:
        return jsonify(
            {
                "message": "You already have an active request",
                "job": _serialize_job(active_job),
            }
        )

    query = {"availability": {"$ne": "Offline"}}
    if worker_ids:
        query["id"] = {"$in": worker_ids}
    elif skill and skill.lower() != "all":
        query["skill"] = {"$regex": f"^{skill}$", "$options": "i"}

    workers = list(workers_col.find(query))
    if not workers:
        return jsonify({"error": "No available partners found for this request"}), 404

    customer = users_col.find_one({"email": customer_email}) if customer_email else None
    jobs = _create_jobs_for_workers(workers, data, customer, customer_email, "broadcast")
    active_job = _active_customer_job(jobs) or (jobs[0] if jobs else None)
    return jsonify(
        {
            "message": f"Request sent to {len(jobs)} nearby partners",
            "job": _serialize_job(active_job),
            "request_group": active_job.get("request_group") if active_job else None,
            "jobs_sent": len(jobs),
        }
    )


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

    update_data = {"status": new_status, "updated_at": _utc_now()}
    jobs_col.update_one({"id": job_id}, {"$set": update_data})
    job.update(update_data)

    if new_status == "Accepted" and job.get("request_group"):
        jobs_col.update_many(
            {
                "request_group": job.get("request_group"),
                "id": {"$ne": job_id},
                "status": "Pending",
            },
            {"$set": {"status": "Expired", "updated_at": _utc_now()}},
        )

    mail_result = None
    worker_name = job.get("worker_name") or "Your Professional"
    if new_status == "Completed":
        mail_result = send_bill_email(job.get("customer_email"), worker_name, job)
        jobs_col.update_one(
            {"id": job_id},
            {"$set": {"bill_mail": mail_result, "bill_sent_at": _utc_now()}},
        )
    elif new_status == "Paid":
        mail_result = send_receipt_email(job.get("customer_email"), worker_name, job)
        jobs_col.update_one(
            {"id": job_id},
            {"$set": {"receipt_mail": mail_result, "receipt_sent_at": _utc_now()}},
        )

    response = {"message": f"Status updated to {new_status}", "job": _serialize_job(job)}
    if mail_result is not None:
        response["mail"] = mail_result
    return jsonify(response)


@job_bp.route("/reject", methods=["POST"])
def reject_job():
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")

    if not job_id:
        return jsonify({"error": "job_id is required"}), 400

    jobs_col = db_instance.get_collection("jobs")
    job = jobs_col.find_one({"id": job_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("status") != "Pending":
        return jsonify({"error": "Only pending requests can be rejected"}), 400

    update_data = {
        "status": "Rejected",
        "rejected_by": "partner",
        "updated_at": _utc_now(),
    }
    jobs_col.update_one({"id": job_id}, {"$set": update_data})
    job.update(update_data)
    return jsonify({"message": "Request rejected", "job": _serialize_job(job)})


@job_bp.route("/cancel", methods=["POST"])
def cancel_job():
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    cancelled_by = data.get("cancelled_by") or "customer"

    if not job_id:
        return jsonify({"error": "job_id is required"}), 400

    jobs_col = db_instance.get_collection("jobs")
    job = jobs_col.find_one({"id": job_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    request_group = job.get("request_group")
    query = {"id": job_id}
    if request_group:
        query = {"request_group": request_group, "status": {"$in": list(ACTIVE_STATUSES)}}

    result = jobs_col.update_many(
        query,
        {"$set": {"status": "Cancelled", "cancelled_by": cancelled_by, "updated_at": _utc_now()}},
    )
    if result.matched_count == 0:
        return jsonify({"error": "Active job not found"}), 404
    return jsonify({"message": "Request cancelled", "cancelled_by": cancelled_by})
