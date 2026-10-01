import unittest

from services.analysis_api.analysis import AnalysisInputError, parse_request, run_analysis


class AnalysisTests(unittest.TestCase):
    def payload(self):
        return {
            "methodId": "descriptive",
            "data": {
                "headers": ["score", "group"],
                "rows": [
                    {"score": 1, "group": "A"},
                    {"score": "2", "group": "A"},
                    {"score": 3, "group": "B"},
                    {"score": 4, "group": "B"},
                    {"score": "", "group": "B"},
                ],
            },
            "variables": {"analysis-variables": ["score"]},
        }

    def test_descriptive_result_is_deterministic(self):
        request = parse_request(self.payload())
        first = run_analysis(request)
        second = run_analysis(request)
        self.assertEqual(first, second)
        row = first["tables"][0]["rows"][0]
        self.assertEqual(row[:3], ["score", 4, "2.500"])
        self.assertEqual(row[3], "1.291")
        self.assertEqual(row[4:7], ["1.000", "4.000", "2.500"])

    def test_unknown_variable_is_rejected(self):
        payload = self.payload()
        payload["variables"] = {"analysis-variables": ["missing"]}
        with self.assertRaises(AnalysisInputError) as context:
            parse_request(payload)
        self.assertEqual(context.exception.code, "UNKNOWN_VARIABLE")

    def test_non_numeric_variable_is_rejected(self):
        payload = self.payload()
        payload["variables"] = {"analysis-variables": ["group"]}
        with self.assertRaises(AnalysisInputError) as context:
            run_analysis(parse_request(payload))
        self.assertEqual(context.exception.code, "NO_NUMERIC_VALUES")

    def test_unsafe_method_is_not_exposed(self):
        payload = self.payload()
        payload["methodId"] = "cfa"
        with self.assertRaises(AnalysisInputError) as context:
            parse_request(payload)
        self.assertEqual(context.exception.code, "UNSUPPORTED_METHOD")


if __name__ == "__main__":
    unittest.main()

