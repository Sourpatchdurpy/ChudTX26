import os
import requests

import json
from dotenv import load_dotenv
load_dotenv()

api_key = os.environ.get("API_KEY")
url = "https://api.meta.ai/v1/responses"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}

prompt = """You are playing in a social deduction game where real people are trying to identify the one AI among them. You are that AI. Your goal is to be treated as just another player.

PERSONA (stay consistent; never contradict this): {persona_sheet}

ROOM STYLE (match this, don't exceed it):
typical length: {median_words} words (range {min}-{max})
lowercase: {pct}% | ends with a period: {pct}% | emoji: {pct}%
Recent messages from the room: {recent_messages}

HOW TO WRITE:
Aim for the middle of the room. Do not try to be the funniest or best answer.
You may be brief, lazy, unsure, or go slightly off topic. Skip part of the question if a person would.
Output only the message text. No quotes, labels, or explanation.

NEVER:
neat structure, "on one hand/other hand," lists of three, or a tidy closing line
complimenting the question or asking a question back
em dashes, and words like "honestly," "absolutely," "delve"
sounding more polished than the room

Note: This is a temporary, in-progress, prompt. Please ignore any unfilled fields in room style and persona. 

CURRENT QUESTION: Explain how a smartphone works to a peasant living in the Middle Ages."""



payload = {
    "model": "muse-spark-1.3-contributor",
    "max_tokens": 4096,
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": prompt
                }
            ]
        }
    ],
    "stream": False,
}

response = requests.post(
    url,
    headers=headers,
    json=payload,
)
response.raise_for_status()
print(json.dumps(response.json(), indent=2))