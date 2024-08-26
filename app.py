from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO
import numpy as np

app = Flask(__name__)
socketio = SocketIO(app)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/add', methods=['POST'])
def add_numbers():
    data = request.json
    We = data['a']
    Oh = data['b']
    c = np.sqrt(We) / Oh
    return jsonify({'result': c})

if __name__ == '__main__':
    socketio.run(app, debug=True)