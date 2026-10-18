"""Exercise refresh and snapshot replay with real persona/event state."""
import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from jupyter_events import EventLogger
from traitlets.config import LoggingConfigurable

from jupyter_ai_persona_manager import (
    BasePersona,
    ModelConfiguration,
    ModelOption,
    PersonaDefaults,
    SettingConfiguration,
    SettingOption,
)
from jupyter_ai_persona_manager.persona_events import (
    PERSONA_STATE_EVENT_SCHEMA_ID, register_persona_event_schemas,
)
from jupyter_ai_persona_manager.persona_manager import PersonaManager


class _PreparedPersona(BasePersona):
    prepare_calls = 0

    @property
    def defaults(self):
        return PersonaDefaults(
            name="Prepared", description="", avatar_path="", system_prompt=""
        )

    async def prepare(self):
        self.prepare_calls += 1
        self.report_model_configuration(
            ModelConfiguration(current="model-1", options=[ModelOption(id="model-1")])
        )
        self.report_settings_configuration([
            SettingConfiguration(
                id="provider", current="provider-1",
                options=[SettingOption(id="provider-1")],
            )
        ])

    async def process_message(self, message):
        raise AssertionError("Restoration must not process a message")


@pytest.mark.asyncio
async def test_refresh_and_repeat_selection_restore_full_current_state(monkeypatch):
    logger = EventLogger()
    register_persona_event_schemas(logger)
    chat = MagicMock()
    chat.get_id.return_value = "chat-restoration"
    chat.get_path.return_value = "restoration.chat"
    classes = [
        {"module": __name__, "persona_class": _PreparedPersona, "traceback": None}
    ]
    monkeypatch.setattr(PersonaManager, "_ep_persona_classes", classes)
    monkeypatch.setattr(PersonaManager, "_init_ep_persona_classes", lambda self: None)
    monkeypatch.setattr(PersonaManager, "_init_local_persona_classes", lambda self: None)
    parent = LoggingConfigurable()
    parent.serverapp = SimpleNamespace(web_app=SimpleNamespace(settings={}))
    manager = PersonaManager(
        parent=parent,
        chat=chat,
        root_dir="/tmp",
        event_loop=asyncio.get_running_loop(),
        event_logger=logger,
    )
    captured = []

    async def receive(logger, schema_id, data):
        captured.append(data)

    logger.add_listener(schema_id=PERSONA_STATE_EVENT_SCHEMA_ID, listener=receive)

    async def select():
        persona = next(iter(manager.personas.values()))
        await manager._on_persona_selected(
            None, None, {"chat_id": chat.get_id(), "persona_id": persona.id}
        )
        # Run the scheduled quiet preparation, including its final snapshot.
        await asyncio.sleep(0)
        await persona._ensure_prepared()
        await asyncio.sleep(0)
        await logger.gather_listeners()
        return persona

    original = await select()
    await manager.refresh_personas()
    replacement = next(iter(manager.personas.values()))
    assert replacement is not original and replacement.id == original.id
    assert replacement.prepare_calls == 0

    for _ in range(3):
        captured.clear()
        await select()
        assert captured, "Selection must replay a snapshot even when already prepared"
        snapshot = captured[-1]
        assert snapshot["chat_id"] == chat.get_id()
        assert snapshot["model"]["current"] == "model-1"
        assert snapshot["settings"][0]["current"] == "provider-1"
    assert original.prepare_calls == replacement.prepare_calls == 1
    await manager.shutdown_personas()
