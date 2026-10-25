"""Compute basic writing-style statistics for chat messages."""

import re
from statistics import median


# Unicode letters and numbers, with internal apostrophes for contractions.
_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
_EMOJI = re.compile(
    r"[\U0001F000-\U0001FAFF]"  # Faces, objects, flags, and pictographs.
    r"|[\u2600-\u26FF\u2700-\u27BF]"  # Weather, hearts, and dingbats.
    r"|[\u231A\u231B\u23E9-\u23F3\u23F8-\u23FA]"
    r"|[\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE]"
    r"|[\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]"
    r"|[©®™↔-↙↩↪‼⁉ℹ〰]\uFE0F"
    r"|[#*0-9]\uFE0F?\u20E3"  # Keycap sequences, not ordinary digits.
)


def message_analysis(messages: list[str]) -> dict[str, int | float]:
    """Return word counts and style percentages for a list of messages.

    Words are runs of Unicode letters/numbers, including contractions.
    Punctuation and emojis do not count as words. A lowercase word must
    contain a cased letter and have every cased letter in lowercase (using
    str.islower). Percentages range from 0 to 100 and are not rounded.

    A message uses periods if it contains at least one literal '.'. Emoji
    detection covers common Unicode emoji ranges and keycap sequences;
    text-style symbols in those ranges also count. Empty messages count
    toward message percentages and have zero words. Empty input returns
    zeros for every statistic.
    """
    word_counts = []
    lowercase_words = 0
    period_messages = 0
    emoji_messages = 0

    for message in messages:
        words = _WORD.findall(message)
        word_counts.append(len(words))
        lowercase_words += sum(word.islower() for word in words)
        period_messages += "." in message
        emoji_messages += _EMOJI.search(message) is not None

    total_words = sum(word_counts)
    total_messages = len(word_counts)
    return {
        "median_words": median(word_counts) if word_counts else 0,
        "min_words": min(word_counts, default=0),
        "max_words": max(word_counts, default=0),
        "lowercase_word_percentage": (
            100 * lowercase_words / total_words if total_words else 0.0
        ),
        "period_message_percentage": (
            100 * period_messages / total_messages if total_messages else 0.0
        ),
        "emoji_message_percentage": (
            100 * emoji_messages / total_messages if total_messages else 0.0
        ),
    }
