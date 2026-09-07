import os

from flask import Flask, jsonify
from flask_socketio import SocketIO
from werkzeug.exceptions import RequestEntityTooLarge

from origin_auth import OriginAuthentication

app = Flask(__name__)
socketio = SocketIO(app)

# Import routes from other files
from calculateReynoldsNumber import calculate_bp
from regimeDecide import regime_bp
from batchProcess import batch_bp, MAX_BATCH_UPLOAD_BYTES

app.config["MAX_CONTENT_LENGTH"] = MAX_BATCH_UPLOAD_BYTES

# Register Blueprints
app.register_blueprint(calculate_bp)
app.register_blueprint(regime_bp)
app.register_blueprint(batch_bp)


@app.errorhandler(RequestEntityTooLarge)
def handle_request_entity_too_large(_error):
    max_size_mb = MAX_BATCH_UPLOAD_BYTES / (1024 * 1024)
    return jsonify(
        {"error": f"File is too large. Maximum upload size is {max_size_mb:.0f} MB."}
    ), 413

def run_local_server():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug_mode = os.getenv("FLASK_DEBUG", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if debug_mode and host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("FLASK_DEBUG=1 is only supported with loopback HOST values")
    socketio.run(
        app,
        host=host,
        port=port,
        debug=debug_mode,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )


if __name__ == '__main__':
    run_local_server()
else:
    # Wrap after SocketIO so its transport cannot bypass the origin boundary.
    # Imported deployments are protected even without platform environment flags.
    app.wsgi_app = OriginAuthentication(app.wsgi_app)
