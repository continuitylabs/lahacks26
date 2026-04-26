"""HTTP bridge between the Expo client and Northstar's call tooling."""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from northstar_agents import config
from northstar_agents.tools import elevenlabs, twilio


def _coordinator_chat_url() -> str | None:
    """Public chat URL for the Rescue Coordinator on Agentverse / ASI:One.

    Only returned when the coordinator is actually reachable from outside the
    local box, i.e. mailbox mode is on and an Agentverse API key is configured
    (matches the gating in rescue_coordinator.py and run_all.py --mailbox).
    """
    use_mailbox = os.environ.get("NORTHSTAR_USE_MAILBOX", "").lower() in {"1", "true", "yes"}
    if not (use_mailbox and config.AGENTVERSE_API_KEY):
        return None
    return f"https://agentverse.ai/agents/details/{config.address('rescue_coordinator')}/profile"


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
    # Prefer a pre-drafted rescue script the agent network already produced —
    # it's already been through Claude (or the template fallback) and is
    # consistent with what the user saw on the rescue screen. Falls back to
    # the locally composed version when the agent network was unavailable.
    pre_drafted = patient_data.get("rescueScript")
    if isinstance(pre_drafted, str) and pre_drafted.strip():
        return pre_drafted.strip()

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


def build_whatsapp_message(patient_data: dict[str, Any]) -> str:
    patient = patient_data.get("patient", {})
    location = patient_data.get("location", {})
    triage = patient_data.get("triage", {})
    summary_lines = patient_data.get("summary", [])

    latitude = _safe_float(location.get("latitude"))
    longitude = _safe_float(location.get("longitude"))
    lat_text = f"{latitude:.5f}" if latitude is not None else "missing"
    lon_text = f"{longitude:.5f}" if longitude is not None else "missing"

    def _value(value: Any, suffix: str = "") -> str:
        if value is None or value == "":
            return "missing"
        return f"{value}{suffix}"

    patient_name = patient.get("name") or "missing"
    age = _value(patient.get("age"))
    medical_baseline = _value(patient.get("medicalBaseline"))
    location_status = _value(location.get("status"))
    heart_rate = _value(triage.get("heartRate"), " bpm")
    spo2 = _value(triage.get("spo2"), "%")
    perfusion_index = _value(triage.get("perfusionIndex"))
    vitals_confidence = _value(
        round(float(triage["confidence"]) * 100)
        if triage.get("confidence") is not None
        else None,
        "%",
    )

    lines = [
        "NORTHSTAR EMERGENCY ALERT",
        "",
        "Patient",
        f"Name: {patient_name}",
        f"Age: {age}",
        f"Medical baseline: {medical_baseline}",
        "",
        "Location",
        f"GPS: {lat_text}, {lon_text}",
        f"Location status: {location_status}",
        "",
        "Vitals",
        f"Heart rate: {heart_rate}",
        f"SpO2: {spo2}",
        f"Perfusion index: {perfusion_index}",
        f"Vitals confidence: {vitals_confidence}",
    ]

    if summary_lines:
        lines.extend(["", "Summary"])
        lines.extend(str(line) for line in summary_lines)
    else:
        lines.extend(["", "Summary", "missing"])

    chat_url = _coordinator_chat_url()
    if chat_url:
        case_id = patient_data.get("caseId")
        case_id = str(case_id).strip() if case_id else ""
        lines.extend([
            "",
            "Talk to the rescue coordinator agent",
            chat_url,
        ])
        if case_id:
            patient_label = patient_name if patient_name != "missing" else "the patient"
            lines.extend([
                "",
                "Paste this as your first message to load the briefing:",
                f"Status update on {patient_label} (case {case_id})",
            ])

    return "\n".join(lines)


async def place_patient_call(patient_data: dict[str, Any]) -> dict[str, Any]:
    request_id = f"call_{int(time.time())}"
    script = build_script(patient_data)
    whatsapp_body = build_whatsapp_message(patient_data)
    target = patient_data.get("contactTarget") or config.CALL_TARGET_NUMBER
    _log(
        "Preparing emergency outreach",
        {
            "requestId": request_id,
            "target": target,
            "location": patient_data.get("location"),
            "triage": patient_data.get("triage"),
        },
    )
    _log(
        "WhatsApp dispatch",
        {
            "requestId": request_id,
            "target": target,
            "chars": len(whatsapp_body),
            "preview": whatsapp_body[:160],
        },
    )
    whatsapp_sid, whatsapp_error = await twilio.send_whatsapp_message(
        whatsapp_body,
        to_number=target,
    )
    _log("WhatsApp result", {"whatsappSid": whatsapp_sid, "error": whatsapp_error})

    _log(
        "ElevenLabs outbound call dispatch",
        {
            "requestId": request_id,
            "target": target,
            "chars": len(script),
            "preview": script[:160],
        },
    )
    call_sid, conversation_id, call_error = await elevenlabs.place_outbound_call(
        script_text=script,
        to_number=target,
    )
    _log(
        "ElevenLabs outbound call result",
        {
            "callSid": call_sid,
            "conversationId": conversation_id,
            "error": call_error,
        },
    )

    if call_sid:
        status = "called"
        notes = "Call placed successfully through ElevenLabs."
    else:
        status = "failed"
        notes = call_error or "ElevenLabs outbound calling is not configured."

    notes_parts: list[str] = []
    if whatsapp_sid:
        notes_parts.append(f"WhatsApp sent (SID {whatsapp_sid}).")
    elif whatsapp_error:
        notes_parts.append(f"WhatsApp failed: {whatsapp_error}")
    notes_parts.append(notes)

    return {
        "ok": call_sid is not None or whatsapp_sid is not None,
        "status": status,
        "callSid": call_sid,
        "whatsappSid": whatsapp_sid,
        "rescueScript": script,
        "notes": " ".join(notes_parts),
        "audioUrl": None,
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
