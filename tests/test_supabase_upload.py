import contextlib
import io
import unittest
import urllib.error
from unittest.mock import patch

import _supabase_upload


class SupabaseUploadTests(unittest.TestCase):
    def test_upsert_uses_bearer_auth_and_composite_conflict_key(self):
        response = contextlib.nullcontext(io.BytesIO())
        with (
            patch.object(_supabase_upload, "SUPABASE_KEY", "test-service-secret"),
            patch.object(_supabase_upload, "SUPABASE_URL", "https://example.test"),
            patch.object(_supabase_upload.time, "sleep"),
            patch("urllib.request.urlopen", return_value=response) as urlopen,
        ):
            _supabase_upload.upsert_rows(
                "turkey_weekly",
                [{"week_start": "10/26/2026", "condition": "Fresh"}],
                on_conflict="week_start,week_end,condition",
            )

        request = urlopen.call_args.args[0]
        self.assertIn(
            "on_conflict=week_start,week_end,condition",
            request.full_url,
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer test-service-secret")
        self.assertEqual(request.get_header("Apikey"), "test-service-secret")

    def test_retries_transient_errors_without_logging_credentials(self):
        error = urllib.error.HTTPError(
            "https://example.test",
            503,
            "unavailable",
            {},
            io.BytesIO(b"service secret should not be printed"),
        )
        response = contextlib.nullcontext(io.BytesIO())
        output = io.StringIO()
        with (
            patch.object(_supabase_upload, "SUPABASE_KEY", "test-service-secret"),
            patch.object(_supabase_upload.time, "sleep"),
            patch("urllib.request.urlopen", side_effect=[error, response]) as urlopen,
            contextlib.redirect_stdout(output),
        ):
            _supabase_upload.upsert_rows("turkey_weekly", [{"id": 1}])

        self.assertEqual(urlopen.call_count, 2)
        self.assertNotIn("test-service-secret", output.getvalue())
        self.assertNotIn("service secret", output.getvalue())


if __name__ == "__main__":
    unittest.main()
