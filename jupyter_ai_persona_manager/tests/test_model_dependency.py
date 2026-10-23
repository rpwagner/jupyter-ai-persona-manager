"""Generic model-domain schema, event transport, and message application tests."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from jupyter_events import EventLogger

from jupyter_ai_persona_manager import (
    ModelConfiguration,
    ModelDependency,
    ModelDomain,
    ModelOption,
    ModelSpec,
    SettingConfiguration,
    SettingOption,
)
from jupyter_ai_persona_manager.persona_events import (
    PERSONA_STATE_EVENT_SCHEMA_ID,
    PersonaSessionState,
    register_persona_event_schemas,
)
from .test_base_persona import _make_persona


def configuration():
    return ModelConfiguration(
        current="A1",
        options=[ModelOption(id="A1"), ModelOption(id="A2")],
        settings=[SettingConfiguration(id="detail", current="low")],
        dependency=ModelDependency(
            setting_id="backend",
            values={
                value: ModelDomain(
                    default_model=f"{value}1",
                    options=[ModelOption(id=f"{value}1"), ModelOption(id=f"{value}2")],
                )
                for value in ("A", "B")
            },
        ),
    )


def test_schema_is_additive_and_round_trips():
    legacy = ModelConfiguration.model_validate(
        {"current": "A1", "options": [], "settings": []}
    )
    assert legacy.dependency is None
    model = configuration()
    assert ModelConfiguration.model_validate_json(model.model_dump_json()) == model
    assert model.model_dump()["dependency"]["values"]["B"] == {
        "default_model": "B1",
        "options": [
            {"id": "B1", "name": None, "description": None},
            {"id": "B2", "name": None, "description": None},
        ],
    }
    assert ModelDomain().default_model is None
    assert ModelDependency(setting_id="backend").values == {}


@pytest.mark.asyncio
async def test_partial_event_and_full_catchup_carry_dependency():
    logger = EventLogger()
    register_persona_event_schemas(logger)
    captured = []

    async def listener(logger, schema_id, data):
        captured.append(data)

    logger.add_listener(schema_id=PERSONA_STATE_EVENT_SCHEMA_ID, listener=listener)
    state = PersonaSessionState(
        event_logger=logger,
        persona_id="configurable",
        chat_id="chat",
        log=logging.getLogger(__name__),
    )
    state.model = configuration()
    await logger.gather_listeners()
    state.publish()
    await logger.gather_listeners()
    assert len(captured) == 2
    for event in captured:
        assert ModelConfiguration.model_validate(event["model"]) == configuration()
    assert "settings" not in captured[0]
    assert "settings" in captured[1]


def make_persona(dependent=True):
    persona = _make_persona(MagicMock())
    persona.state = PersonaSessionState(
        event_logger=None,
        persona_id="configurable",
        chat_id="chat",
        log=logging.getLogger(__name__),
    )
    model = configuration()
    if not dependent:
        model.dependency = None
    persona.state.model = model
    persona.state.settings = [
        SettingConfiguration(
            id="backend",
            current="A",
            options=[SettingOption(id="A"), SettingOption(id="B")],
        ),
        SettingConfiguration(id="format", current="plain"),
    ]
    calls = []

    async def update_settings(settings):
        calls.append(("settings", settings))
        if "backend" in settings:
            backend = settings["backend"]
            # The implementation that owns the setting publishes the actual
            # post-switch model state, including its default and settings.
            switched = configuration()
            switched.current = f"{backend}1"
            switched.options = switched.dependency.values[backend].options
            persona.report_model_configuration(switched)

    async def update_model(model):
        calls.append(("model", model))

    async def update_model_settings(settings):
        calls.append(("model_settings", settings))

    persona.update_settings = update_settings
    persona.update_model = update_model
    persona.update_model_settings = update_model_settings
    return persona, calls


@pytest.mark.asyncio
@pytest.mark.parametrize("dependent", [True, False])
async def test_message_application_order(dependent):
    persona, calls = make_persona(dependent)
    metadata = {
        "settings": {"backend": "B", "format": "rich"},
        "model": {"id": "B2", "settings": {"detail": "high"}},
    }
    await persona.apply_specs_in_message(SimpleNamespace(metadata=metadata))
    if dependent:
        assert calls == [
            ("settings", {"backend": "B"}),
            ("model", "B2"),
            ("model_settings", {"detail": "high"}),
            ("settings", {"format": "rich"}),
        ]
        assert persona.get_model() == "B2"
        assert persona.get_model_settings() == {"detail": "high"}
    else:
        assert calls == [
            ("model", "B2"),
            ("model_settings", {"detail": "high"}),
            ("settings", {"backend": "B", "format": "rich"}),
        ]
    assert metadata["settings"] == {"backend": "B", "format": "rich"}
    assert persona.get_settings() == {"backend": "B", "format": "rich"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata",
    [
        None,
        {},
        {"model": None, "settings": None},
        {
            "model": {"id": None, "settings": {"detail": None}},
            "settings": {"backend": None, "format": None},
        },
        {
            "model": {"id": "A1", "settings": {"detail": "low"}},
            "settings": {"backend": "A", "format": "plain"},
        },
    ],
)
async def test_null_unspecified_and_redundant_values_are_noops(metadata):
    persona, calls = make_persona()
    await persona.apply_specs_in_message(SimpleNamespace(metadata=metadata))
    assert calls == []
    assert persona.get_model() == "A1"


@pytest.mark.asyncio
async def test_null_model_uses_default_published_by_setting_owner():
    persona, calls = make_persona()
    await persona.apply_specs_in_message(
        SimpleNamespace(metadata={"settings": {"backend": "B"}, "model": ModelSpec()})
    )
    assert calls == [("settings", {"backend": "B"})]
    assert persona.get_model() == "B1"


@pytest.mark.asyncio
async def test_remaining_settings_without_controlling_value():
    persona, calls = make_persona()
    await persona.apply_specs_in_message(
        SimpleNamespace(
            metadata={"settings": {"format": "rich"}, "model": ModelSpec(id="A2")}
        )
    )
    assert calls == [("model", "A2"), ("settings", {"format": "rich"})]


@pytest.mark.asyncio
async def test_setting_failure_stops_before_model_changes():
    persona, calls = make_persona()
    persona.update_settings = AsyncMock(side_effect=ValueError("backend unavailable"))
    with pytest.raises(ValueError, match="backend unavailable"):
        await persona.apply_specs_in_message(
            SimpleNamespace(
                metadata={"settings": {"backend": "B"}, "model": {"id": "B2"}}
            )
        )
    assert calls == []
    assert persona.get_model() == "A1"
