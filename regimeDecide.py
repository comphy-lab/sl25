import math
from pathlib import Path

from flask import Blueprint, request, jsonify

from SLtheory_prediction import load_model_payload, predict_beta_from_payload

regime_bp = Blueprint('regime', __name__)
MODEL_PAYLOAD = load_model_payload(Path(__file__).resolve().with_name('SLtheory_model.json'))

# Define the regime classification function
def classify_regime(row):
    oh, we = row['Oh'], row['We']
    if oh <= 1 / we ** 2:
        return 'I'
    elif 1 / we ** 2 < oh <= 1 / we ** (3 / 4):
        return 'II'
    elif 1 / we ** (3 / 4) < oh <= we ** 0.5:
        return 'III'
    elif we ** 0.5 < oh:
        return 'IV'
    else:
        return 'Undefined'

@regime_bp.route('/regime', methods=['POST'])
def decide_regime():
    if not request.is_json:
        return jsonify({'error': 'Expected application/json'}), 400

    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'error': 'Invalid JSON'}), 400
    if not isinstance(data, dict):
        return jsonify({'error': 'JSON body must be an object'}), 400

    weber_number = data.get('weberNumber')
    ohnesorge_number = data.get('ohnesorgeNumber')
    if weber_number is None or ohnesorge_number is None:
        return jsonify({'error': 'Missing parameters'}), 400
    try:
        weber_number = float(weber_number)
        ohnesorge_number = float(ohnesorge_number)
        if not math.isfinite(weber_number) or not math.isfinite(ohnesorge_number):
            return jsonify({'error': 'Inputs must be finite'}), 400
        if weber_number <= 0 or ohnesorge_number <= 0:
            return jsonify({'error': 'Inputs must be positive'}), 400
        row = {'We': weber_number, 'Oh': ohnesorge_number}
        regime = classify_regime(row)
        pred_beta = predict_beta_from_payload(
            MODEL_PAYLOAD,
            oh=ohnesorge_number,
            we=weber_number,
        )
        return jsonify({'regime': regime, 'predBeta': pred_beta})
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid input'}), 400
