"""HTTP bridge between the Expo client and Northstar's call tooling."""
from __future__ import annotations

import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from northstar_agents import config
from northstar_agents.tools import elevenlabs, twilio


OUT_DIR = Path(__file__).resolve().parent / "out"


def _log(*parts: Any) -> None:
    print("[NorthstarBridge]", *parts, flush=True)


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def build_script(patient_data: dict[str, Any]) -> str:
    patient = patient_data.get("patient", {})
    location = patient_data.get("location", {})
    triage = patient_data.get("triage", {})
    summary_lines = patient_data.get("summary", [])

    latitude = _safe_float(location.get("latitude"))
    longitude = _safe_float(location.get("longitude"))
    lat_text = f"{latitude:.5f}" if latitude is not None else "unknown"
    lon_text = f"{longitude:.5f}" if longitude is not None else "unknown"

    script_parts = [
        "This is an automated emergency call from Northstar.",
        f"I am calling about {patient.get('name') or 'an unknown patient'}.",
        f"The callback number for the patient device is {config.CALL_TARGET_NUMBER}.",
        f"Latest coordinates are latitude {lat_text}, longitude {lon_text}.",
    ]

    if summary_lines:
        script_parts.append("Current patient data follows.")
        script_parts.extend(str(line) for line in summary_lines)

    if triage.get("confidence") is not None:
        script_parts.append(
            f"Reading confidence is {round(float(triage['confidence']) * 100)} percent."
        )

    script_parts.append("Please treat this as a demo rescue escalation and connect to the patient as needed.")
    return " ".join(script_parts)


async def place_patient_call(patient_data: dict[str, Any]) -> dict[str, Any]:
    request_id = f"call_{int(time.time())}"
    script = build_script(patient_data)
    _log(
        "Preparing call",
        {
            "requestId": request_id,
            "target": patient_data.get("contactTarget") or config.CALL_TARGET_NUMBER,
            "location": patient_data.get("location"),
            "triage": patient_data.get("triage"),
        },
    )
    audio_path = await elevenlabs.synthesize(script, label=request_id)
    _log("ElevenLabs audio path:", audio_path or "none")

    audio_url = None
    if audio_path and config.PUBLIC_BASE_URL:
        audio_url = f"{config.PUBLIC_BASE_URL.rstrip('/')}/audio/{Path(audio_path).name}"
    _log("Public audio URL:", audio_url or "none")

    call_sid, call_error = await twilio.place_call(
        script_text=script,
        to_number=patient_data.get("contactTarget") or config.CALL_TARGET_NUMBER,
        audio_url=audio_url,
    )
    _log("Twilio result", {"callSid": call_sid, "error": call_error})

    if call_sid:
        status = "called"
        notes = "Call placed successfully."
    elif audio_path:
        status = "voiced"
        notes = (
            f"Voice synthesized, but Twilio could not place the call. {call_error}"
            if call_error
            else "Voice synthesized, but Twilio could not place the call."
        )
    else:
        status = "failed"
        notes = call_error or "Voice synthesis or Twilio calling is not configured."

    return {
        "ok": call_sid is not None,
        "status": status,
        "callSid": call_sid,
        "rescueScript": script,
        "notes": notes,
        "audioUrl": audio_url,
    }


class _CallBridgeHandler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:  # noqa: D401
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            _log("Health check request received")
            body = json.dumps(
                {
                    "ok": True,
                    "publicBaseUrl": config.PUBLIC_BASE_URL,
                    "callBridgePort": config.CALL_BRIDGE_PORT,
                    "twilioConfigured": bool(
                        config.TWILIO_ACCOUNT_SID
                        and config.TWILIO_AUTH_TOKEN
                        and config.TWILIO_FROM_NUMBER
                    ),
                    "elevenlabsConfigured": bool(config.ELEVENLABS_API_KEY),
                }
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path.startswith("/audio/"):
            file_name = parsed.path.replace("/audio/", "", 1)
            file_path = OUT_DIR / file_name
            if file_path.exists():
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.end_headers()
                self.wfile.write(file_path.read_bytes())
                return

        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/call":
            self.send_response(404)
            self.end_headers()
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            patient_data = payload.get("patientData") or {}
            _log("Incoming /call request", patient_data)

            result = asyncio.run(place_patient_call(patient_data))
            status_code = 200 if result["ok"] else 502
            _log("Bridge response", {"statusCode": status_code, "result": result})
        except Exception as exc:
            result = {
                "ok": False,
                "status": "failed",
                "callSid": None,
                "rescueScript": None,
                "notes": f"Call bridge error: {exc}",
                "audioUrl": None,
            }
            status_code = 500
            _log("Bridge exception", str(exc))

        body = json.dumps(result).encode("utf-8")

        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return


def start_bridge_server() -> ThreadingHTTPServer:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", config.CALL_BRIDGE_PORT), _CallBridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", config.CALL_BRIDGE_PORT), _CallBridgeHandler)
    _log(f"Call bridge listening on 0.0.0.0:{config.CALL_BRIDGE_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
