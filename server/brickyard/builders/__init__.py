from brickyard.builders.demo import DemoBuilder
from brickyard.builders.holo import HoloBuilder
from brickyard.session import Builder

holo = HoloBuilder.from_env()
BUILDERS: dict[str, Builder] = {**({"holo": holo} if holo else {}), "demo": DemoBuilder()}
