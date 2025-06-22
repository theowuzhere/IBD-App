# app.py
import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import requests

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Retrieve Gemini API key from environment variables
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

@app.route('/gemini-proxy', methods=['POST'])
def gemini_proxy():
    if not GEMINI_API_KEY:
        return jsonify({"error": "Gemini API Key not configured on the server."}), 500

    try:
        # Get data from the frontend request
        data = request.json
        model = data.get('model', 'gemini-2.0-flash') # Default to gemini-2.0-flash
        payload = data.get('payload')

        if not payload:
            return jsonify({"error": "Payload is missing from the request body."}), 400

        # Construct the Gemini API URL
        gemini_api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"

        # Make the request to the Gemini API
        headers = {'Content-Type': 'application/json'}
        response = requests.post(gemini_api_url, json=payload, headers=headers)
        response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

        return jsonify(response.json())

    except requests.exceptions.RequestException as e:
        print(f"Error calling Gemini API: {e}")
        return jsonify({"error": f"Failed to connect to Gemini API: {e}"}), 500
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return jsonify({"error": f"An unexpected server error occurred: {e}"}), 500

@app.route('/')
def home():
    return "Backend is running. Access the frontend in your browser."

if __name__ == '__main__':
    # Use 0.0.0.0 to make the server accessible from outside the container (if running in one)
    app.run(debug=False, host='0.0.0.0', port=5000)
