import ast
import unittest
from pathlib import Path


SERVICE_DIR = Path(__file__).resolve().parent
SERVER_PATH = SERVICE_DIR / "server.py"
START_SCRIPT_PATH = SERVICE_DIR / "start-qwen3-asr.sh"


class Qwen3AsrNetworkBindingTest(unittest.TestCase):
    def test_server_defaults_to_loopback_host(self):
        tree = ast.parse(SERVER_PATH.read_text(encoding="utf-8"))
        parse_args = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "parse_args"
        )

        host_arguments = [
            call
            for call in ast.walk(parse_args)
            if isinstance(call, ast.Call)
            and isinstance(call.func, ast.Attribute)
            and call.func.attr == "add_argument"
            and call.args
            and isinstance(call.args[0], ast.Constant)
            and call.args[0].value == "--host"
        ]

        self.assertEqual(len(host_arguments), 1)
        default_values = [
            keyword.value
            for keyword in host_arguments[0].keywords
            if keyword.arg == "default"
        ]
        self.assertEqual(len(default_values), 1)
        default_value = default_values[0]
        self.assertIsInstance(default_value, ast.Constant)
        self.assertEqual(default_value.value, "127.0.0.1")

    def test_wsl_launcher_keeps_service_on_loopback(self):
        script = START_SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn("--host 127.0.0.1", script)
        self.assertNotIn("--host 0.0.0.0", script)


if __name__ == "__main__":
    unittest.main()
