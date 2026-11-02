import sys
import json
import random
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 2,
    "title": "Кодирование и декодирование информации (шифры, Морзе, цепочки)",
    "has_variants": False
}

# =============================================================================
# ВИЗУАЛЬНОЕ ФОРМАТИРОВАНИЕ ШИФРОВ (ЗАЩИТА ОТ СЛИПАНИЯ ТИРЕ ПРИ ПЕЧАТИ)
# =============================================================================

def fmt_code(s):
    """
    Добавляет чёткий межсимвольный интервал (letter-spacing), чтобы идущие подряд
    тире (−−−−), точки (••••) и спецсимволы (???, !!!) никогда не сливались
    в сплошную линию на экране и при печати любым шрифтом.
    """
    return f'<span style="letter-spacing: 2.2px; font-weight: 700;">{s}</span>'

# =============================================================================
# СПРАВОЧНИКИ СЛОВ И ТАБЛИЦ
# =============================================================================

# Слова без повторяющихся букв для Архетипа 1 (шпионы, условие уникальности букв)
WORDS_NO_REPEATS = [
    "ОЛИМП", "ЛИМОН", "ЛЕСКА", "ПОЛЕТ", "ПИЛОТ", "КАТЕР", "ФАКЕЛ",
    "ПАРОМ", "СПОРТ", "ТУМАН", "ОКЕАН", "ВЕТКА", "ПЕСОК", "АРБУЗ",
    "ВИЛКА", "ШКОЛА", "КНИГА", "СМОЛА", "ПАРУС", "ЗЕБРА", "КОБРА",
    "ФИКУС", "ГРУША", "СЛИВА", "МЕЧТА", "ВЕСНА", "ОСЕНЬ", "БИЗОН",
    "ВИРУС", "ГОРОД", "ДОЖДЬ", "ЗАМОК", "ИГРОК", "КАПЛЯ", "ЛЕНТА",
    "МАЯК", "НАУКА", "ОЗЕРО", "ПТИЦА", "РАДИО", "САЛЮТ", "ТАНЕЦ"
]
WORDS_NO_REPEATS = [w for w in WORDS_NO_REPEATS if len(w) == len(set(w))]

# Слова для однозначного декодирования (Агент 007, пароли, киностудия)
WORDS_GENERAL = [
    "БЫК", "ЛАК", "КОЛ", "РОК", "МОРС", "ВОРС", "РИТА", "ТЕМА",
    "ВЕТЕР", "ГОЛОВА", "ВОРОТА", "ОБЛАКО", "РАКЕТА", "КОМЕТА",
    "ПАРОЛЬ", "СИГНАЛ", "ОСТРОВ", "КАПКАН", "БАРАБАН", "МОЛОКО",
    "ЗОЛОТО", "СЕРЕБРО", "КОЛОКОЛ", "КАРАВАН", "ПАРОВОЗ", "САМОЛЕТ",
    "МАРШРУТ", "КОМПАС", "ТАЙНИК", "СЕКРЕТ", "ПИРАТ", "КОРАБЛЬ",
    "ШТОРМ", "БЕРЕГ", "ОКЕАН", "АЛМАЗ", "РУБИН", "ГРАНИТ", "МАГНИТ"
]

# Короткие русские слова для Архетипа 5 (выбор 1 из 3 двоичных цепочек)
SHORT_RUS_WORDS = [
    ("НОС", "АДКНОС"), ("ОДА", "АДКНОС"), ("СОН", "АДКНОС"), ("КОД", "АДКНОС"),
    ("СОК", "АДКНОС"), ("ДНО", "АДКНОС"), ("ОСА", "АДКНОС"), ("КОСА", "АДКНОС"),
    ("ДОМ", "АДМНОС"), ("СОМ", "АДМНОС"), ("МОДА", "АДМНОС"), ("СОНМ", "АДМНОС"),
    ("ДАР", "АВДОРСУ"), ("ВВОД", "АВДОРУ"), ("РОД", "АВДОРСУ"), ("РОВ", "АВДОРСУ"),
    ("УДАР", "АВДОРСУ"), ("ВОДА", "АВДОРСУ"), ("РУДА", "АВДОРСУ"), ("СВОД", "АВДОРСУ"),
    ("УЗОР", "АВЗОРУ"), ("РОЗА", "АВЗОРУ"), ("ВЗОР", "АВЗОРУ"), ("ГРОЗА", "АВГЗОРУ"),
    ("БАК", "АБКЛОС"), ("БЛОК", "АБКЛОС"), ("СКОЛ", "АБКЛОС"), ("КОЛБА", "АБКЛОС"),
    ("КРАН", "АКМНОР"), ("КОРМ", "АКМНОР"), ("НОРА", "АКМНОР"), ("МРАК", "АКМНОР"),
    ("РОМАН", "АКМНОР"), ("НОРМА", "АКМНОР"), ("КОМАР", "АКМНОР"), ("КАРМАН", "АКМНОР"),
    ("ЛЕТО", "ЕКЛОСТ"), ("СТОЛ", "ЕКЛОСТ"), ("СЕЛО", "ЕКЛОСТ"), ("СТЕКЛО", "ЕКЛОСТ"),
    ("МОСТ", "ИМНОСТ"), ("НИТЬ", "ИМНОСТЬ"), ("ЛИСТ", "ИЛНОСТ"), ("СЛОН", "ИЛНОСТ")
]

# Азбука Морзе
MORSE_TABLE = {
    "А": "•−",   "Б": "−•••", "В": "•−−",  "Г": "−−•",
    "Д": "−••",  "Е": "•",    "Ж": "•••−", "З": "−−••",
    "И": "••",   "Й": "•−−−", "К": "−•−",  "Л": "•−••",
    "М": "−−",   "Н": "−•",   "О": "−−−",  "П": "•−−•",
    "Р": "•−•",  "С": "•••",  "Т": "−",    "У": "••−",
    "Ф": "••−•", "Х": "••••", "Ц": "−•−•", "Ч": "−−−•",
    "Ш": "−−−−", "Щ": "−−•−", "Ы": "−•−−", "Ь": "−••−",
    "Э": "••−••","Ю": "••−−", "Я": "•−•−"
}

RUS_ALPHABET = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
ENG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Математически выверенные слова для Архетипа 6 (каждое имеет СТРОГО 1 разбор в алфавитной нумерации!)
RUS_ALPHABET_WORDS = [
    "БИТЬ", "ВИТЬ", "ЖИТЬ", "ДАТА", "ГАТЬ", "ДАТЬ", "ЖАТЬ",
    "ДЕДА", "ДЕД", "ДЕТИ", "ГИД", "ТИТ", "БИТ", "ВИД",
    "ВИЗА", "ДИЕТА", "ВЕДЬ", "ВЕЗТИ", "ВЕТВЬ", "ВЕЗДЕ", "ВДЕТЬ",
    "ВЖАТЬ", "ИЗБИТЬ", "ИЗВИТЬ", "ИЗЖИТЬ", "ИЗДАТЬ", "ИЗГИБ", "ДЕВИЗ",
    "ЖИТЬЕ", "ТЕГ", "ТАТЬ", "ТАИТЬ", "ГДЕ", "ГАИ", "ЕДА",
    "ЕЗДА", "ЕЖИ", "ЖЖЕТ", "ЖДЕТ", "ИДЕТ", "ВЕДЕТ", "ВЗБИТЬ"
]

ENG_ALPHABET_WORDS = [
    "FAT", "CAT", "HAT", "EAT", "DATE", "HATE", "FATE", "GATE",
    "CHAT", "CHEAT", "HEAT", "FEAT", "ICE", "DICE", "HIDE", "TIDE",
    "EDIT", "DIET", "CITE", "BITE", "BIG", "DIG", "FIG", "HIT",
    "FIT", "BIT", "GET", "JET", "FETE", "CHEF", "CHIEF", "THIEF",
    "GIFT", "TEETH", "FEET", "FEED", "DEED", "IDEA", "HIGH", "FIGHT", "TIGHT"
]

# =============================================================================
# УНИВЕРСАЛЬНЫЙ РЕШАТЕЛЬ ДЕКОДИРОВАНИЯ (DFS С МЕМОИЗАЦИЕЙ)
# =============================================================================

def find_all_decodings(encoded_str, code_to_char, max_limit=150):
    """Возвращает все возможные варианты расшифровки строки encoded_str."""
    memo = {}

    def backtrack(idx):
        if idx == len(encoded_str):
            return [""]
        if idx in memo:
            return memo[idx]

        results = []
        for code, ch in code_to_char.items():
            if encoded_str.startswith(code, idx):
                for suffix in backtrack(idx + len(code)):
                    results.append(ch + suffix)
                    if len(results) >= max_limit:
                        break
            if len(results) >= max_limit:
                break

        memo[idx] = results
        return results

    return backtrack(0)

# =============================================================================
# АРХЕТИП 1: ШПИОНЫ — БУКВЫ В СООБЩЕНИИ НЕ ПОВТОРЯЮТСЯ (18%)
# =============================================================================

def generate_spy_no_repeats():
    symbol_sets = [
        ("@", "+", "~"),
        ("*", "@", "~"),
        ("+", "#", "^"),
        ("~", "#", "+")
    ]
    rus_letters = list("АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ")

    for _ in range(80):
        word = random.choice(WORDS_NO_REPEATS)
        word_chars = list(word)
        extra_char = random.choice([c for c in rus_letters if c not in word_chars])
        table_chars = word_chars + [extra_char]
        random.shuffle(table_chars)

        s1, s2, s3 = random.choice(symbol_sets)
        patterns = [
            s1, s2,
            s1 + s2, s2 + s1, s3 + s1, s1 + s3, s2 + s3, s3 + s2,
            s1 + s3 + s2, s2 + s1 + s3, s3 + s2 + s1
        ]
        chosen_codes = random.sample(patterns, len(table_chars))

        char_to_code = {table_chars[i]: chosen_codes[i] for i in range(len(table_chars))}
        code_to_char = {v: k for k, v in char_to_code.items()}

        encoded_str = "".join(char_to_code[ch] for ch in word)
        all_dec = find_all_decodings(encoded_str, code_to_char)
        unique_dec = [d for d in all_dec if len(d) == len(set(d))]

        # Требуем, чтобы без условия уникальности букв было >1 разбора, а с ним — строго 1
        if len(all_dec) >= 2 and len(unique_dec) == 1 and unique_dec[0] == word:
            prompt = (
                "Вася и Петя играли в шпионов и кодировали сообщения собственным шифром. "
                "Расшифруйте сообщение, если известно, что буквы в нём не повторяются (запишите в ответе расшифрованное слово):\n"
                f"{fmt_code(encoded_str)}"
            )
            return {
                "task": prompt,
                "code_table": {
                    "headers": table_chars,
                    "rows": [[fmt_code(char_to_code[ch]) for ch in table_chars]]
                },
                "variants": None,
                "answer": word
            }
    return None

# =============================================================================
# АРХЕТИП 2: РАДИОГРАММА РАЗВЕДЧИКА (АЗБУКА МОРЗЕ ИЛИ 0/1) (22%)
# =============================================================================

def generate_morse_radiogram():
    use_binary = random.random() < 0.25
    ask_count = random.random() < 0.20
    all_morse_chars = list(MORSE_TABLE.keys())

    for _ in range(80):
        table_chars = random.sample(all_morse_chars, 5)
        char_to_code = {}
        for ch in table_chars:
            raw_morse = MORSE_TABLE[ch]
            if use_binary:
                char_to_code[ch] = raw_morse.replace("•", "0").replace("−", "1")
            else:
                char_to_code[ch] = raw_morse

        code_to_char = {v: k for k, v in char_to_code.items()}

        msg_len = random.randint(5, 10) if ask_count else random.randint(5, 7)
        msg_chars = [random.choice(table_chars) for _ in range(msg_len)]
        if len(set(msg_chars)) < 4:
            continue

        word = "".join(msg_chars)
        encoded_str = "".join(char_to_code[ch] for ch in word)
        decodings = find_all_decodings(encoded_str, code_to_char)

        if len(decodings) == 1 and decodings[0] == word:
            morse_desc = "двоичного кода азбуки Морзе" if use_binary else "азбуки Морзе"
            if ask_count:
                prompt = (
                    f"От разведчика была получена шифрованная радиограмма, переданная с использованием {morse_desc}. "
                    "При передаче было потеряно разбиение на буквы, но известно, что использовались только приведённые в таблице буквы. "
                    "Определите текст радиограммы. В ответе укажите, сколько букв было в исходной радиограмме:\n"
                    f"{fmt_code(encoded_str)}"
                )
                ans = str(len(word))
            else:
                prompt = (
                    f"От разведчика была получена шифрованная радиограмма, переданная с использованием {morse_desc}. "
                    "При передаче было потеряно разбиение на буквы, но известно, что использовались только приведённые в таблице буквы. "
                    "Расшифруйте радиограмму и запишите в ответе полученную последовательность букв:\n"
                    f"{fmt_code(encoded_str)}"
                )
                ans = word

            return {
                "task": prompt,
                "code_table": {
                    "headers": table_chars,
                    "rows": [[fmt_code(char_to_code[ch]) for ch in table_chars]]
                },
                "variants": None,
                "answer": ans
            }
    return None

# =============================================================================
# АРХЕТИП 3: ОДНОЗНАЧНЫЙ АВТОРСКИЙ ИЛИ ДВОИЧНЫЙ ШИФР (23%)
# =============================================================================

def generate_custom_cipher_unique():
    stories = [
        ("Агент 007, передавая важные сведения своему напарнику, закодировал сообщение придуманным шифром.", [("€", "?"), ("?", "©"), ("£", "€")]),
        ("Ваня и Коля переписываются при помощи придуманного шифра (разделителей между кодами букв нет).", [("@", "&"), ("!", "?")]),
        ("Ребята играли в разведчиков и закодировали сообщение придуманным шифром.", [("Λ", "Ω"), ("*", "+")]),
        ("На киностудии снимали фильм про шпионов и закодировали сообщение двоичным шифром.", [("0", "1")]),
        ("От разведчика было получено сообщение, в котором зашифрован пароль — последовательность русских букв.", [("0", "1")])
    ]

    story_text, alphabets = random.choice(stories)
    s1, s2 = random.choice(alphabets)
    rus_letters = list("АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ")

    code_pool = [
        s1 + s2, s2 + s1, s1 + s1, s2 + s2,
        s1 + s1 + s2, s1 + s2 + s1, s2 + s1 + s1,
        s2 + s2 + s1, s2 + s1 + s2, s1 + s2 + s2,
        s1 + s1 + s1, s2 + s2 + s2
    ]

    for _ in range(80):
        word = random.choice(WORDS_GENERAL)
        unique_word_chars = list(dict.fromkeys(word))
        if len(unique_word_chars) > 6:
            continue

        need_extra = max(0, random.choice([5, 6]) - len(unique_word_chars))
        extra_chars = random.sample([c for c in rus_letters if c not in unique_word_chars], need_extra)
        table_chars = unique_word_chars + extra_chars
        random.shuffle(table_chars)

        chosen_codes = random.sample(code_pool, len(table_chars))
        char_to_code = {table_chars[i]: chosen_codes[i] for i in range(len(table_chars))}
        code_to_char = {v: k for k, v in char_to_code.items()}

        encoded_str = "".join(char_to_code[ch] for ch in word)
        decodings = find_all_decodings(encoded_str, code_to_char)

        if len(decodings) == 1 and decodings[0] == word:
            ask_len = (random.random() < 0.15)
            if ask_len:
                prompt = (
                    f"{story_text} В сообщении присутствуют только буквы из приведённого фрагмента кодовой таблицы. "
                    f"Определите, сколько букв содержит сообщение:\n"
                    f"{fmt_code(encoded_str)}"
                )
                ans = str(len(word))
            else:
                prompt = (
                    f"{story_text} В сообщении присутствуют только буквы из приведённого фрагмента кодовой таблицы. "
                    f"Определите, какое сообщение закодировано в строке (запишите последовательность букв без пробелов):\n"
                    f"{fmt_code(encoded_str)}"
                )
                ans = word

            return {
                "task": prompt,
                "code_table": {
                    "headers": table_chars,
                    "rows": [[fmt_code(char_to_code[ch]) for ch in table_chars]]
                },
                "variants": None,
                "answer": ans
            }
    return None

# =============================================================================
# АРХЕТИП 4: ПОИСК ПОВТОРЯЮЩИХСЯ БУКВ В СООБЩЕНИИ (9%)
# =============================================================================

def generate_repeating_letters():
    letter_pool = list("АБВГДЕЖЗИКЛМНОПРСТУ")
    patterns_pool = [
        "..o..", ".o..o", ".oo.o", ".oooo", "...o.", ".o.oo",
        "o..o.", "oo..o", ".o.o.", "o.o.o", "o...o", "..oo."
    ]

    for _ in range(60):
        table_chars = sorted(random.sample(letter_pool, 6))
        chosen_codes = random.sample(patterns_pool, 6)
        char_to_code = {table_chars[i]: chosen_codes[i] for i in range(6)}
        code_to_char = {v: k for k, v in char_to_code.items()}

        rep_count = random.choice([2, 3])
        rep_chars = random.sample(table_chars, rep_count)
        single_chars = random.sample([c for c in table_chars if c not in rep_chars], random.choice([1, 2]))

        msg_list = rep_chars * 2 + single_chars
        random.shuffle(msg_list)
        word = "".join(msg_list)

        encoded_str = "".join(char_to_code[ch] for ch in word)
        decodings = find_all_decodings(encoded_str, code_to_char)

        if len(decodings) == 1 and decodings[0] == word:
            ans = "".join(sorted(rep_chars))
            prompt = (
                "Сообщение было зашифровано кодом. Использовались только буквы, приведённые в таблице. "
                "Определите, какие буквы в сообщении повторяются, и запишите их в ответе в алфавитном порядке без пробелов:\n"
                f"{fmt_code(encoded_str)}"
            )
            return {
                "task": prompt,
                "code_table": {
                    "headers": table_chars,
                    "rows": [[fmt_code(char_to_code[ch]) for ch in table_chars]]
                },
                "variants": None,
                "answer": ans
            }
    return None

# =============================================================================
# АРХЕТИП 5: ВЫБОР ЕДИНСТВЕННОЙ ОДНОЗНАЧНОЙ ЦЕПОЧКИ ИЗ ТРЁХ (14%)
# =============================================================================

def generate_three_chains_one_unique():
    for _ in range(100):
        target_word, alphabet_str = random.choice(SHORT_RUS_WORDS)
        table_chars = sorted(list(set(alphabet_str)))

        codes_len2 = random.sample(["01", "10", "00", "11"], 2)
        codes_len3 = random.sample(["100", "101", "110", "111", "000", "001", "010", "011"], len(table_chars) - 2)
        chosen_codes = codes_len2 + codes_len3
        random.shuffle(chosen_codes)

        char_to_code = {table_chars[i]: chosen_codes[i] for i in range(len(table_chars))}
        code_to_char = {v: k for k, v in char_to_code.items()}

        target_chain = "".join(char_to_code[ch] for ch in target_word)
        target_dec = find_all_decodings(target_chain, code_to_char)
        if len(target_dec) != 1 or target_dec[0] != target_word:
            continue

        ambiguous_chains = []
        for _ in range(60):
            rand_word = "".join(random.choice(table_chars) for _ in range(random.choice([3, 4])))
            chain = "".join(char_to_code[ch] for ch in rand_word)
            if chain == target_chain or any(chain == c[0] for c in ambiguous_chains):
                continue
            decs = find_all_decodings(chain, code_to_char)
            if len(decs) >= 2:
                ambiguous_chains.append((chain, decs[0], decs[1]))
            if len(ambiguous_chains) >= 3:
                break

        if len(ambiguous_chains) < 3:
            continue

        ex_chain, ex_w1, ex_w2 = ambiguous_chains[0]
        distractor_chains = [ambiguous_chains[1][0], ambiguous_chains[2][0]]

        chains = distractor_chains + [target_chain]
        random.shuffle(chains)
        chains_str = "   ".join(f"{i + 1}) {fmt_code(chains[i])}" for i in range(3))

        prompt = (
            f"Валя шифрует русские слова (последовательности букв), записывая вместо каждой буквы её код. "
            f"Некоторые цепочки можно расшифровать не одним способом (например, {ex_chain} может означать не только «{ex_w1}», но и «{ex_w2}»).\n"
            f"Даны три кодовые цепочки: {chains_str}\n"
            f"Найдите среди них ту, которая имеет только одну расшифровку, и запишите в ответе расшифрованное слово. Кодовая таблица:"
        )

        return {
            "task": prompt,
            "code_table": {
                "headers": table_chars,
                "rows": [[fmt_code(char_to_code[ch]) for ch in table_chars]]
            },
            "variants": None,
            "answer": target_word
        }
    return None

# =============================================================================
# АРХЕТИП 6: ШИФРОВКА ПО НОМЕРАМ БУКВ В АЛФАВИТЕ (1 ИЗ 4) (14%)
# =============================================================================

def generate_alphabet_numbers():
    is_russian = random.random() < 0.60

    if is_russian:
        alphabet = RUS_ALPHABET
        words_pool = RUS_ALPHABET_WORDS
        lang_adj = "русские"
        ex_text = "например, 12112 может означать «АБАК», может — «КАК», а может — «АБААБ»"
    else:
        alphabet = ENG_ALPHABET
        words_pool = ENG_ALPHABET_WORDS
        lang_adj = "английские"
        ex_text = "например, 16118 может означать «AFAR», может — «PAR», а может — «AFAAH»"

    char_to_code = {alphabet[i]: str(i + 1) for i in range(len(alphabet))}
    code_to_char = {str(i + 1): alphabet[i] for i in range(len(alphabet))}

    for _ in range(80):
        target_word = random.choice(words_pool)
        target_chain = "".join(char_to_code[ch] for ch in target_word)

        target_decs = find_all_decodings(target_chain, code_to_char)
        if len(target_decs) != 1 or target_decs[0] != target_word:
            continue

        distractors = []
        ambig_nums = [n for n in range(1, len(alphabet) + 1) if n % 10 != 0]
        for _ in range(100):
            rand_chars = [alphabet[random.choice(ambig_nums) - 1] for _ in range(random.choice([3, 4]))]
            chain = "".join(char_to_code[ch] for ch in rand_chars)

            if chain == target_chain or chain in distractors:
                continue
            if not (len(target_chain) - 1 <= len(chain) <= len(target_chain) + 1):
                continue

            decs = find_all_decodings(chain, code_to_char)
            if len(decs) >= 2:
                distractors.append(chain)
            if len(distractors) == 3:
                break

        if len(distractors) < 3:
            continue

        all_chains = distractors + [target_chain]
        random.shuffle(all_chains)
        chains_line = "   ".join(f"{i + 1}) {fmt_code(all_chains[i])}" for i in range(4))

        used_letters_set = set()
        for ch_str in all_chains:
            for i in range(len(ch_str)):
                for step in (1, 2):
                    if i + step <= len(ch_str):
                        sub = ch_str[i:i + step]
                        if sub in code_to_char:
                            used_letters_set.add(code_to_char[sub])

        sorted_used_letters = sorted(used_letters_set, key=lambda c: alphabet.index(c))
        student_name = random.choice(["Ваня", "Вася", "Гена", "Кирилл"])

        prompt = (
            f"{student_name} шифрует {lang_adj} слова, записывая вместо каждой буквы её порядковый номер в алфавите (без пробелов). "
            f"Некоторые шифровки можно расшифровать несколькими способами ({ex_text}).\n"
            f"Даны четыре шифровки: {chains_line}\n"
            f"Только одна из них расшифровывается единственным способом. Найдите её, расшифруйте и запишите получившееся слово в ответе. "
            f"Номера букв:"
        )

        return {
            "task": prompt,
            "code_table": {
                "headers": sorted_used_letters,
                "rows": [[char_to_code[ch] for ch in sorted_used_letters]]
            },
            "variants": None,
            "answer": target_word
        }
    return None

# =============================================================================
# ТОЧКА ВХОДА ГЕНЕРАТОРА
# =============================================================================

def generate():
    random.seed(os.urandom(16))

    while True:
        archetype = random.choices(
            ["spy_unique", "morse", "custom_unique", "repeats", "three_chains", "alphabet_nums"],
            weights=[0.18, 0.22, 0.23, 0.09, 0.14, 0.14],
            k=1
        )[0]

        if archetype == "spy_unique":
            res = generate_spy_no_repeats()
        elif archetype == "morse":
            res = generate_morse_radiogram()
        elif archetype == "custom_unique":
            res = generate_custom_cipher_unique()
        elif archetype == "repeats":
            res = generate_repeating_letters()
        elif archetype == "three_chains":
            res = generate_three_chains_one_unique()
        else:
            res = generate_alphabet_numbers()

        if res is not None:
            return res

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))