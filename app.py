import os
from flask import Flask, render_template, jsonify
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
