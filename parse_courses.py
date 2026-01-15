
import re
import csv
import sys

def parse_schedule(input_path, output_path):
    with open(input_path, 'r', encoding='utf-8') as f:
        lines = [line.strip() for line in f if line.strip()]

    # Improved Regex to find the [L P U] STAT SEC pattern.
    # Matches: space + (1 to 3 numbers separated by space) + space + (Letter) + space + (digits) + space
    # Group 1: The numbers string (e.g. "3 0 3" or "1" or "16")
    # Group 2: The STAT letter (L, P, T, R, I, etc.)
    # Group 3: The Section number
    # Improved Regex to find the [L P U] STAT SEC pattern.
    # Matches: space + (1 to 3 numbers separated by space) + space + (Letter) + space + (digits) + space
    # Group 1: The numbers string (e.g. "3 0 3" or "1" or "16")
    # Group 2: The STAT letter (L, P, T, U, R, I) -- restricted to prevent matching Days
    # Group 3: The Section number
    lpu_pattern = re.compile(r'\s((?:\d+\s+){0,2}\d+)\s+([LPTURI])\s+(\d+)\s')

    entries = []
    
    current_course_lines = []
    current_exam_lines = []
    
    def finalize_entry(course_lines, exam_lines):
        if not course_lines:
            return None
            
        full_text = " ".join(course_lines)
        
        # Search for LPU
        match = lpu_pattern.search(full_text)
        if not match:
            # Fallback for weird lines or missing stats (e.g. BITS K101)
            # Try to grab COMCODE and COURSE_NO
            parts = full_text.split()
            comcode = parts[0] if parts else ""
            course_no = ""
            title = ""
            tail = "" # No LPU, so cannot split tail easily OR everything after TITLE is tail?
            # Without LPU, we can't easily separate INSTRUCTOR from TITLE if they are merged.
            # But usually INSTRUCTOR follows LPU. So if LPU is missing, maybe Instructor is also not standard?
            # We will put remaining text in TITLE for safety.
            
            if len(parts) >= 3:
                # Heuristic: COMCODE [DEPT NO] ...
                course_no = f"{parts[1]} {parts[2]}" 
                title = " ".join(parts[3:])
            elif len(parts) >= 2:
                course_no = parts[1]
                title = ""
            else:
                title = full_text

            return {
                'COMCODE': comcode,
                'COURSE_NO': course_no,
                'TITLE': title,
                'L': '', 'P': '', 'U': '',
                'STAT': '', 'SEC': '',
                'INSTRUCTOR_TIMING_ROOM': '', 
                'EXAM_DETAILS': " | ".join(exam_lines)
            }
            
        start, end = match.span()
        lpu_str, stat, sec = match.groups()
        
        head = full_text[:start].strip()
        tail = full_text[end:].strip()
        
        # Parse LPU numbers
        # lpu_str could be "3 0 3" or "1" or "16"
        lpu_parts = lpu_str.split()
        if len(lpu_parts) == 3:
            l, p, u = lpu_parts
        elif len(lpu_parts) == 1:
            # Ambiguous. Put in U? Or L? Let's put in U (Units) if it's total, 
            # but usually single number is units.
            l, p, u = '', '', lpu_parts[0]
        else:
            # 2 numbers? rare. just join
            l, p, u = '', '', " ".join(lpu_parts)
        
        # Head: COMCODE COURSE_NO TITLE
        parts = head.split()
        comcode = parts[0]
        
        # Heuristic for Course No and Title
        # Usually: COMCODE [DEPT FXXX] Title...
        # Check if parts[1] is Dept (letters) and parts[2] is No (letters+digits)
        course_no = ""
        title = ""
        
        if len(parts) >= 3:
            # Check pattern of part 2
            # formatting often: "BIO F101"
            course_no = f"{parts[1]} {parts[2]}"
            title = " ".join(parts[3:])
        else:
            title = " ".join(parts[1:])

        joined_exams = " | ".join(exam_lines)
        
        return {
            'COMCODE': comcode,
            'COURSE_NO': course_no,
            'TITLE': title,
            'L': l, 'P': p, 'U': u,
            'STAT': stat, 'SEC': sec,
            'INSTRUCTOR_TIMING_ROOM': tail,
            'EXAM_DETAILS': joined_exams
        }

    # Iterate lines
    for line in lines:
        stripped = line.strip()
        
        # Filter Junk
        if "COMCODE" in line and "COURSE NO" in line: continue
        if stripped in ["DATE (SLOT)", "MID SEM", "DATE, DAY", "TIME", "BIRLA INSTITUTE OF TECHNOLOGY AND SCIENCE, PILANI- K. K. BIRLA GOA CAMPUS", "TIMETABLE SECOND SEMESTER 2025- 2026", "TBA TBA"]:
            continue
        if stripped == "MID SEM": continue
        
        # Check if new Course Entry
        # Starts with digits (COMCODE, usually 5-6 chars), followed by space and letters.
        # e.g. "022863 BIO..."
        # Prevent "1 L 1" from matching (start digit length)
        is_new_course = re.match(r'^\d{4,}\s+[A-Z]+', stripped)
        
        # Check if Exam line
        # Dates, Days, Times
        is_exam = False
        if re.search(r'\d{2}/\d{2}/\d{2}', stripped): is_exam = True
        elif re.search(r'\d+:\d+\s*(AM|PM)', stripped): is_exam = True
        elif stripped.endswith(('AM -', 'PM -', 'AM', 'PM')): is_exam = True
        elif stripped in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']: max_len_day = True; is_exam = True
        
        # Decision
        if is_new_course:
            if current_course_lines:
                rec = finalize_entry(current_course_lines, current_exam_lines)
                if rec: entries.append(rec)
                current_course_lines = []
                current_exam_lines = []
            current_course_lines.append(stripped)
        
        elif is_exam:
            if current_course_lines:
                current_exam_lines.append(stripped)
            else:
                # orphan exam line? Ignore
                pass
        
        else:
            # Continuation of course (Title wrap, Instructor list wrap)
            # CAUTION: Ensure we don't accidentally merge separate unrelated lines if logic fails.
            # But with CSV structure, we assume everything between courses is related to the previous course.
            if current_course_lines:
                current_course_lines.append(stripped)

    # Flush last
    if current_course_lines:
        rec = finalize_entry(current_course_lines, current_exam_lines)
        if rec: entries.append(rec)

    # Write CSV
    headers = ['COMCODE', 'COURSE_NO', 'TITLE', 'L', 'P', 'U', 'STAT', 'SEC', 'INSTRUCTOR_TIMING_ROOM', 'EXAM_DETAILS']
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for r in entries:
            writer.writerow(r)

if __name__ == "__main__":
    parse_courses_path = '/home/debraj/is_this_class_free/parse_courses.py'
    input_file = '/home/debraj/is_this_class_free/temp.txt'
    output_file = '/home/debraj/is_this_class_free/temp.csv'
    parse_schedule(input_file, output_file)
    print("CSV generated.")
