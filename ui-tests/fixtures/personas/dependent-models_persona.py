"""Deterministic configurable persona; no external backend or credentials."""

import json
import os

from jupyter_ai_persona_manager import (
    BasePersona,
    ModelConfiguration,
    ModelDependency,
    ModelDomain,
    ModelOption,
    PersonaDefaults,
    SettingConfiguration,
    SettingOption,
)


class DependentModelsPersona(BasePersona):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.backend = "A"
        self.applied = []
        self.report_settings_configuration(
            [
                SettingConfiguration(
                    id="backend",
                    name="Backend",
                    current="A",
                    options=[SettingOption(id=value) for value in ("A", "B")],
                ),
                SettingConfiguration(
                    id="format",
                    name="Format",
                    current="plain",
                    options=[SettingOption(id=value) for value in ("plain", "rich")],
                ),
            ]
        )
        self.publish_models()

    @property
    def defaults(self):
        return PersonaDefaults(
            name="Dependent Models Persona",
            description="Generic model-domain fixture",
            avatar_path=os.path.join(os.environ["JAI_TEST_ASSETS_DIR"], "persona.svg"),
            system_prompt="unused",
        )

    def publish_models(self):
        domains = {
            value: ModelDomain(
                default_model=f"{value}1",
                options=[
                    ModelOption(id=model)
                    for model in (f"{value}1", f"{value}2", "shared")
                ],
            )
            for value in ("A", "B")
        }
        domain = domains[self.backend]
        self.report_model_configuration(
            ModelConfiguration(
                current=domain.default_model,
                options=domain.options,
                settings=[
                    SettingConfiguration(
                        id="detail",
                        name="Detail",
                        current="low",
                        options=[SettingOption(id=value) for value in ("low", "high")],
                    )
                ],
                dependency=ModelDependency(setting_id="backend", values=domains),
            )
        )

    async def update_settings(self, settings):
        for key, value in settings.items():
            self.applied.append(f"{key}:{value}")
        if "backend" in settings:
            self.backend = settings["backend"]
            self.publish_models()

    async def update_model(self, model_id):
        assert model_id in {
            option.id for option in self.get_model_configuration().options
        }, "model applied before backend"
        self.applied.append(f"model:{model_id}")

    async def update_model_settings(self, settings):
        for key, value in settings.items():
            self.applied.append(f"{key}:{value}")

    async def process_message(self, message):
        reply = {
            "backend": self.backend,
            "model": self.get_model(),
            "settings": self.get_settings(),
            "applied": self.applied,
            "metadata": message.metadata,
        }
        self.applied = []
        self.send_message(json.dumps(reply, sort_keys=True))
