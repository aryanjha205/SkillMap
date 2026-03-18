import os
from flask import Flask, render_template, jsonify, url_for
from flask_cors import CORS
from dotenv import load_dotenv
from routes.auth_routes import auth_bp
from routes.worker_routes import worker_bp
from routes.job_routes import job_bp
from routes.admin_routes import admin_bp

load_dotenv()

import json
from utils.db import db_instance

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-key-123')
CORS(app)

# Custom JSON Provider to handle MongoDB ObjectId
class CustomJSONProvider(Flask.json_provider_class):
    def dumps(self, obj, **kwargs):
        return json.dumps(obj, default=str, **kwargs)

app.json = CustomJSONProvider(app)


@app.context_processor
def inject_asset_helpers():
    def asset_url(filename):
        file_path = os.path.join(app.static_folder, filename)
        version = None
        try:
            version = int(os.path.getmtime(file_path))
        except OSError:
            version = None
        if version is None:
            return url_for('static', filename=filename)
        return url_for('static', filename=filename, v=version)

    return {"asset_url": asset_url}

# Helper routes for PWA
@app.route('/manifest.json')
def serve_manifest():
    return app.send_static_file('manifest/manifest.json')

@app.route('/sw.js')
def serve_sw():
    return app.send_static_file('sw.js')

@app.route('/favicon.ico')
def favicon():
    return app.send_static_file('manifest/icon-192.png')

# Register Blueprints
app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(worker_bp, url_prefix='/api/workers')
app.register_blueprint(job_bp, url_prefix='/api/jobs')
app.register_blueprint(admin_bp, url_prefix='/api/admin')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/customer')
def customer_page():
    return render_template('customer.html')

@app.route('/partner')
def partner_page():
    return render_template('partner.html')

@app.route('/admin')
def admin_page():
    return render_template('admin.html')

@app.route('/health')
def health():
    return jsonify({
        "status": "healthy", 
        "db": "connected" if db_instance.db is not None else "unavailable",
        "db_error": db_instance.last_error
    })


@app.route('/health/email')
def email_health():
    smtp_username = os.getenv('SMTP_USERNAME') or os.getenv('MAIL_DEFAULT_SENDER')
    smtp_password = os.getenv('SMTP_PASSWORD')
    return jsonify({
        "configured": bool(smtp_username and smtp_password),
        "smtp_server": os.getenv('SMTP_SERVER', 'smtp.gmail.com'),
        "smtp_port": os.getenv('SMTP_PORT', '587'),
        "sender_present": bool(smtp_username),
        "password_present": bool(smtp_password)
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
