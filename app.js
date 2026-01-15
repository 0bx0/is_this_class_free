document.addEventListener('DOMContentLoaded', () => {
    const timetable = document.getElementById('timetable');
    const roomInput = document.getElementById('roomInput');
    const statusMessage = document.getElementById('statusMessage');

    let allCourses = [];
    let classroomIndex = {}; // Map: Room -> [CourseObjects]

    // Constants
    const DAYS = ['M', 'T', 'W', 'TH', 'F', 'S'];
    const DAY_MAP = {
        'M': 'Monday', 'T': 'Tuesday', 'W': 'Wednesday', 'TH': 'Thursday', 'F': 'Friday', 'S': 'Saturday'
    };

    // JS GetDay returns 0=Sun, 1=Mon...6=Sat.
    // We map 1->M, 2->T, 3->W, 4->TH, 5->F, 6->S. 0 is ignored or handled.
    const JS_DAY_TO_CODE = ['S', 'M', 'T', 'W', 'TH', 'F', 'S']; // Index 0 is Sun (which we treat as S or ignore?) Let's assume Sun is empty.

    // Hours: 1 (8-9), 2 (9-10), ... 11 (6-7)
    // Map current hour (0-23) to slot index (1-11)
    // 8:00-8:59 -> 1
    // ...
    // 18:00-18:59 -> 11

    // Initialize Grid Rows
    DAYS.forEach(day => {
        // Day Label
        const dayLabel = document.createElement('div');
        dayLabel.className = 'day-cell';
        dayLabel.textContent = day;
        timetable.appendChild(dayLabel);

        // 11 Slots
        for (let i = 1; i <= 11; i++) {
            const slot = document.createElement('div');
            slot.className = 'slot-cell';
            slot.dataset.day = day;
            slot.dataset.hour = i;
            slot.id = `slot-${day}-${i}`; // Unique ID for updating
            timetable.appendChild(slot);
        }
    });

    // Fetch and Parse Data
    Papa.parse('./temp.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
            console.log("CSV Loaded", results.data.length);
            allCourses = results.data;
            processCourses(allCourses);
            highlightCurrentTime();
        },
        error: function (err) {
            console.error("Error fetching CSV:", err);
            statusMessage.textContent = "Error loading schedule data.";
        }
    });

    function processCourses(data) {
        // Build an index: Room -> parsed items
        classroomIndex = {};

        data.forEach(row => {
            const rawTiming = row.INSTRUCTOR_TIMING_ROOM;
            if (!rawTiming) return;

            // Parse the timing string
            // Example: "Indrani Talukdar / Raviprasad Aduri M W 2 LT4"
            // Example complex: "K Tarakanath, Narayan Suresh Manjarekar, Martin Cherangal J W 7 8" (Missing room? No, header says room is in string)
            // Wait, regex logic in python was: extracted Tail.
            // The tail contains [Instructor Names] [Days] [Hours] [Room]
            // We need to robustly extract [Days] [Hours] [Room].
            // Strategy: Tokenize from right to left?
            // Room is usually last. Hours are digits before it. Days are letters before that.

            const parsed = parseScheduleString(rawTiming);
            if (parsed && parsed.room) {
                const roomKey = parsed.room.toUpperCase().replace(/\s/g, ''); // Normalize key

                if (!classroomIndex[roomKey]) {
                    classroomIndex[roomKey] = [];
                }

                parsed.slots.forEach(slot => {
                    classroomIndex[roomKey].push({
                        day: slot.day,
                        hour: slot.hour,
                        code: row.COURSE_NO || row.COMCODE,
                        title: row.TITLE,
                        instructor: parsed.instructor // Optional
                    });
                });
            }
        });

        // Trigger initial render if input has value (e.g. refresh)
        if (roomInput.value) {
            renderSchedule(roomInput.value);
        }
    }

    function parseScheduleString(text) {
        // This is the tricky part.
        // Known patterns:
        // "M W 2 LT4" -> Days: M, W. Hours: 2. Room: LT4.
        // "T TH 2 F 10 C302" -> Block 1: T TH 2. Block 2: F 10. Room: C302 (Shared?)
        // "M W F 3 A503"
        // "TBA" -> Skip

        if (!text || text.includes('TBA')) return null;

        // Normalize spaces
        let clean = text.trim().replace(/\s+/g, ' ');

        // Regex to find "Tokens that look like Days/Hours/Room at the end"
        // But Instructor names can be anything.
        // HOWEVER, Days are from set [M, T, W, TH, F, S]. Hours are digits.
        // Look for the *sequence* of Day/Hour tokens.

        // Matches clusters like: (M|T|W|TH|F|S)+ (\d+)+
        // Let's try to match all occurrences of [Days] followed by [Digits]

        const dayRegex = /\b(M|T|W|TH|F|S)\b/g;
        const hourRegex = /\b(\d{1,2})\b/g; // 1-12

        // Strategy: 
        // 1. Identify valid Day/Hour blocks.
        // 2. Anything *after* the last Day/Hour block is likely the Room.
        // 3. Anything *before* is Instructor logic (we might ignore instructor for now).

        // Actually, we need to associate specific days with specific hours.
        // "T TH 2 F 10 C302" -> (T, TH) @ 2, (F) @ 10. Room C302.

        // Let's split by space and iterate.
        const tokens = clean.split(' ');
        const slots = [];
        let currentDays = [];
        let currentHours = [];

        let i = 0;
        let lastTimeIndex = -1;

        // We need to parse from left to right to pair days and hours?
        // OR better: Scan for Day tokens, accumulate. When Digit tokens appear, assign accumulated days to those digits. Reset days.
        // Record the index of the last Digit token.
        // Everything after last Digit token is Room.

        // Check tokens
        const isDay = (t) => ['M', 'T', 'W', 'TH', 'F', 'S'].includes(t);
        const isHour = (t) => /^\d{1,2}$/.test(t);

        for (let j = 0; j < tokens.length; j++) {
            const token = tokens[j];

            if (isDay(token)) {
                // If we have currentHours but now match a day -> we are starting a NEW block.
                // But wait, "M W 2 3" -> M, W are days. 2, 3 are hours. 
                // "M 2 W 3" -> M@2, W@3.

                // If we hit a day, and we previously had *Hours* populated, it means the previous block ended.
                if (currentHours.length > 0) {
                    // Flush previous
                    flushBlock(slots, currentDays, currentHours);
                    currentDays = [];
                    currentHours = [];
                }
                currentDays.push(token);
                lastTimeIndex = j;
            } else if (isHour(token)) {
                currentHours.push(parseInt(token));
                lastTimeIndex = j;
            } else {
                // Determine if it's instructor or room later
                // If we encounter text and we have pending days/hours, it usually means end of block OR room.
                // But instructor names appear BEFORE days usually.
                // "Instructor Names M W 2 Room"
                // So if we find tokens that are NOT day/hour, we ignore them until we find day/hour?

                // What if "room" is between blocks? Unlikely.
            }
        }

        // Flush last block
        flushBlock(slots, currentDays, currentHours);

        if (slots.length === 0) return null; // No schedule found

        // Extract Room
        // Room is typically everything after `lastTimeIndex`.
        let room = "";
        if (lastTimeIndex < tokens.length - 1) {
            room = tokens.slice(lastTimeIndex + 1).join(' ');
        }

        // Clean room (remove "Saturday TBA" etc if caught)
        // If room is empty, maybe it was mixed in? But usually it's at end.
        if (!room) return null; // Need a room to map it.

        return { room, slots };
    }

    function flushBlock(slots, days, hours) {
        if (days.length > 0 && hours.length > 0) {
            days.forEach(d => {
                hours.forEach(h => {
                    slots.push({ day: d, hour: h });
                });
            });
        }
    }

    function renderSchedule(rawInput) {
        // Clear Grid
        document.querySelectorAll('.slot-cell').forEach(cell => {
            cell.classList.remove('booked');
            cell.innerHTML = '';
        });

        const key = rawInput.toUpperCase().replace(/\s/g, '');
        if (!key) return;

        // Exact match logic first.
        // "LT4" matches "LT4".
        // What about partial? "LT" should not match everything.

        const courses = classroomIndex[key];

        if (courses) {
            courses.forEach(c => {
                const cellId = `slot-${c.day}-${c.hour}`;
                const cell = document.getElementById(cellId);
                if (cell) {
                    cell.classList.add('booked');
                    // Add content
                    const info = document.createElement('span');
                    info.className = 'course-code';
                    info.textContent = c.code || 'BOOKED';
                    cell.appendChild(info);
                }
            });
            statusMessage.textContent = `Showing schedule for ${rawInput}`;
        } else {
            statusMessage.textContent = `No schedule found for ${rawInput}`;
        }

        // Keep highlights
        highlightCurrentTime();
    }

    // Input Listener
    roomInput.addEventListener('input', (e) => {
        renderSchedule(e.target.value);
    });

    // Highlighting Logic
    function highlightCurrentTime() {
        // Clear previous
        document.querySelectorAll('.current-day-row').forEach(el => el.classList.remove('current-day-row'));
        document.querySelectorAll('.current-hour-col').forEach(el => el.classList.remove('current-hour-col'));
        document.querySelectorAll('.current-now').forEach(el => el.classList.remove('current-now'));

        const now = new Date();
        const dayIndex = now.getDay(); // 0=Sun
        const hour = now.getHours();

        // 1. Highlight Day
        const dayCode = JS_DAY_TO_CODE[dayIndex];
        // If Sunday (0) or invalid, maybe skip?
        if (dayCode && dayCode !== 'S') { // Wait check 'S' index 0 vs 6
            // JS 0=Sun, 1=Mon. Our array 0='S'(Sun?), 1='M'.
            // Actually our array is ['S','M','T','W','TH','F','S']. 0=Sun. 6=Sat.
            // My DAY_MAP is 'S' for Saturday?
            // Let's ensure logic matches.
            // If Day is Monday (1) -> dayCode 'M'.
            // Find all cells with dataset.day = 'M' and add class.
            document.querySelectorAll(`.slot-cell[data-day="${dayCode}"]`).forEach(cell => {
                cell.classList.add('current-day-row');
            });
            // Also highlight label? Labels don't have dataset.
            // Maybe finding row by structure is better, but dataset is easy.
        }

        // 2. Highlight Hour
        // hour is 0-23.
        // Slots are 1 (8-9), 2 (9-10) ... 11 (6-7 PM -> 18-19)
        // Formula: slot = hour - 7.
        // 8 AM -> 8-7 = 1.
        // 18 PM -> 18-7 = 11.

        let currentSlot = hour - 7;
        if (currentSlot >= 1 && currentSlot <= 11) {
            document.querySelectorAll(`.slot-cell[data-hour="${currentSlot}"]`).forEach(cell => {
                cell.classList.add('current-hour-col');
            });

            // Intersection
            if (dayCode) {
                const nowCell = document.getElementById(`slot-${dayCode}-${currentSlot}`);
                if (nowCell) nowCell.classList.add('current-now');
            }
        }
    }

    // Update highlight every minute
    setInterval(highlightCurrentTime, 60000);

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered!', reg))
            .catch(err => console.error('SW Registration failed', err));
    }

    // Status Card Logic
    const statusCard = document.getElementById('currentStatusCard');
    const statusValue = document.getElementById('statusValue');

    function updateStatusCard(room) {
        if (!room) {
            statusCard.classList.add('hidden');
            return;
        }

        // Find current usage
        const now = new Date();
        const dayIndex = now.getDay();
        const hour = now.getHours();
        const currentSlot = hour - 7;
        const dayCode = JS_DAY_TO_CODE[dayIndex];

        let isBooked = false;
        let currentCourse = null;

        const key = room.toUpperCase().replace(/\s/g, '');
        const courses = classroomIndex[key];

        if (courses && dayCode && dayCode !== 'S' && currentSlot >= 1 && currentSlot <= 11) {
            currentCourse = courses.find(c => c.day === dayCode && c.hour === currentSlot);
            if (currentCourse) isBooked = true;
        }

        statusCard.classList.remove('hidden');
        statusCard.classList.remove('free', 'booked');

        if (isBooked) {
            statusCard.classList.add('booked');
            statusValue.textContent = `OCCUPIED (${currentCourse.code})`;
        } else {
            statusCard.classList.add('free');
            statusValue.textContent = "FREE NOW";
        }
    }

    // Hook into renderSchedule to update card
    const originalRender = renderSchedule;
    renderSchedule = function (rawInput) {
        originalRender(rawInput);
        updateStatusCard(rawInput);
    };

});
