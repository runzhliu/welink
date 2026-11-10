"""Optional real-hardware regression; never downloads a model or uses chat data."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import sys
import unittest

from welink_worker.runtime import Inference


@unittest.skipUnless(sys.platform == "darwin" and os.environ.get("WELINK_TEST_MODEL_PATH"), "需要 Apple Silicon 和本机模型路径")
class MLXThreadedInferenceTest(unittest.TestCase):
    def test_model_loaded_on_main_thread_streams_on_request_threads(self):
        model_path = Path(os.environ["WELINK_TEST_MODEL_PATH"])
        self.assertTrue(model_path.is_dir())
        runner = Inference({"engine": "mlx", "seed": 42}, model_path)
        try:
            def request():
                chunks = list(runner.stream([{"role": "user", "content": "合成测试：请回复你好。"}], max_tokens=12, temperature=0))
                self.assertTrue("".join(chunks))
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(request) for _ in range(2)]
                for future in futures:
                    future.result()
        finally:
            runner.close()
