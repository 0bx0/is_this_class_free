
import re

text = "022861 BITS F102 INNOVATION AND DESIGN THINKING 1 L 1 SANJAY KUMAR W 11 LT4"
lpu_pattern = re.compile(r'\s((?:\d+\s+){0,2}\d+)\s+([A-Z])\s+(\d+)\s')

match = lpu_pattern.search(text)
if match:
    print("Match found:", match.groups())
else:
    print("No match")
