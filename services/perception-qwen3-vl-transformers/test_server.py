from __future__ import annotations

import unittest

import torch

from server import (
    StableServiceError,
    constrained_choice_confidence,
    strict_objective_json,
)


VALID_OBJECTIVE = (
    '{"events":[{"eventType":"screen.activity.observed",'
    '"value":{"kind":"enum","value":"browser"},"confidence":0.9}]}'
)


class StrictObjectiveJsonTest(unittest.TestCase):
    def test_accepts_surrounding_json_whitespace(self) -> None:
        self.assertEqual(strict_objective_json(f"\n{VALID_OBJECTIVE}\n"), VALID_OBJECTIVE)

    def test_rejects_markdown_or_extra_text(self) -> None:
        for value in (
            f"```json\n{VALID_OBJECTIVE}\n```",
            f"Result: {VALID_OBJECTIVE}",
            f"{VALID_OBJECTIVE}\nDone",
        ):
            with self.subTest(value=value), self.assertRaises(StableServiceError):
                strict_objective_json(value)

    def test_rejects_schema_expansion(self) -> None:
        with self.assertRaises(StableServiceError):
            strict_objective_json(
                '{"events":[{"eventType":"screen.activity.observed",'
                '"value":{"kind":"enum","value":"browser"},'
                '"confidence":0.9,"rawText":"secret"}]}'
            )


class ConstrainedChoiceConfidenceTest(unittest.TestCase):
    def test_uses_only_allowlisted_branch_probability(self) -> None:
        scores = (torch.tensor([[-float("inf"), 1.0, 0.0]]),)
        confidence = constrained_choice_confidence(scores, [1], [[1], [2]])

        self.assertAlmostEqual(confidence, 0.7311, places=4)

    def test_returns_zero_for_missing_scores(self) -> None:
        self.assertEqual(constrained_choice_confidence((), [1], [[1], [2]]), 0.0)


if __name__ == "__main__":
    unittest.main()
