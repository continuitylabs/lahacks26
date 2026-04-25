"""In-process smoke-test client.

Spawned by `run_all.py --smoke-test`. Sends a sample ChatMessage to the
rescue coordinator and prints the markdown reply. Lets you verify the
chat-protocol round-trip without leaving the terminal — useful when you
don't yet have ASI:One access wired up.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)


DEMO_PROMPT = (
    "I just took a hard fall mountain biking on the Backbone Trail near "
    "mile marker 7.2 (34.0848°N, -118.7798°W). I'm bleeding from my left "
    "forearm but conscious. No head trauma. My name is Jake."
)


def make_test_client(coordinator_address: str, prompt: str = DEMO_PROMPT) -> Agent:
    """Build a one-shot uAgent that fires `prompt` at `coordinator_address`."""

    client = Agent(
        name="northstar_smoke_test_client",
        seed="northstar-smoke-test-client-ephemeral-seed",
        port=9999,
        endpoint=["http://127.0.0.1:9999/submit"],
    )
    chat = Protocol(spec=chat_protocol_spec)

    @client.on_event("startup")
    async def _kickoff(ctx: Context) -> None:
        # Give the rest of the Bureau a moment to register their handlers
        # so the coordinator is reachable when we send.
        await asyncio.sleep(1.0)
        ctx.logger.info("─" * 72)
        ctx.logger.info("[SmokeTest] sending sample chat to coordinator…")
        ctx.logger.info(f"[SmokeTest] target: {coordinator_address}")
        ctx.logger.info(f"[SmokeTest] prompt: {prompt[:80]}…")
        ctx.logger.info("─" * 72)
        await ctx.send(
            coordinator_address,
            ChatMessage(
                timestamp=datetime.now(timezone.utc),
                msg_id=uuid4(),
                content=[TextContent(type="text", text=prompt)],
            ),
        )

    @chat.on_message(ChatMessage)
    async def _on_reply(ctx: Context, sender: str, msg: ChatMessage) -> None:
        # Acknowledge per the chat protocol contract.
        await ctx.send(
            sender,
            ChatAcknowledgement(
                timestamp=datetime.now(timezone.utc),
                acknowledged_msg_id=msg.msg_id,
            ),
        )

        text = "\n".join(b.text for b in msg.content if isinstance(b, TextContent))

        # Pretty-print the reply.
        bar = "═" * 72
        print()
        print(bar)
        print("  ✓  Coordinator replied — chat protocol round-trip succeeded")
        print(bar)
        print(text)
        print(bar)
        print(
            "\n[SmokeTest] Test complete. The Bureau is still running so the\n"
            "agents stay registered with Agentverse. Press Ctrl+C to stop.\n"
        )

    @chat.on_message(ChatAcknowledgement)
    async def _on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
        ctx.logger.info("[SmokeTest] coordinator acknowledged our message")

    client.include(chat)
    return client
