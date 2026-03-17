from flask import Blueprint, request, jsonify, render_template
import numpy as np

calculate_bp = Blueprint('calculate', __name__)

@calculate_bp.route('/')
def index():
    return render_template('index.html')

@calculate_bp.route('/add', methods=['POST'])
def add_numbers():
    data = request.get_json(silent=True) or {}
    weber_number = data.get('weberNumber')
    ohnesorge_number = data.get('ohnesorgeNumber')
    if weber_number is None or ohnesorge_number is None:
        return jsonify({'error': 'Missing parameters'}), 400
    try:
        weber_number = float(weber_number)
        ohnesorge_number = float(ohnesorge_number)
        if weber_number <= 0 or ohnesorge_number <= 0:
            return jsonify({'error': 'Inputs must be positive'}), 400
        reynolds_number = np.sqrt(weber_number) / ohnesorge_number
        return jsonify({'result': reynolds_number})
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid input'}), 400
