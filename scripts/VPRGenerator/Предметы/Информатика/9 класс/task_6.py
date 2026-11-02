import sys
import json
import random
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 6,
    "title": "Анализ программ с ветвлением на языке Python (включая параметр A)",
    "has_variants": False
}

# =============================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =============================================================================

INDENT = "&nbsp;&nbsp;&nbsp;&nbsp;"

TIMES_WORDS = {
    2: "два раза",
    3: "три раза",
    4: "четыре раза",
    5: "пять раз",
    6: "шесть раз",
    7: "семь раз",
    8: "восемь раз"
}

def compare_val(val, op, bound):
    if op == ">":
        return val > bound
    if op == "<":
        return val < bound
    if op == ">=":
        return val >= bound
    return val <= bound

def format_pairs(pairs):
    return "; ".join(f"({v1}, {v2})" for v1, v2 in pairs)

def make_boundary_pairs(c1, c2):
    """Создаёт 2 гарантированно различные пограничные пары для проверки знаков неравенств."""
    offset = random.choice([-4, -3, -2, -1, 1, 2, 3, 4])
    if random.choice([True, False]):
        second_pair = (c1, c2 + offset)
    else:
        second_pair = (c1 + offset, c2)
    return [(c1, c2), second_pair]

# =============================================================================
# АРХЕТИП 1: СОСТАВНЫЕ УСЛОВИЯ С AND / OR (35% — примеры 1–8, 11, 13, 14)
# =============================================================================

def generate_simple_logic():
    var1, var2 = ("s", "t") if random.random() < 0.70 else ("s", "k")
    word_yes, word_no = ("YES", "NO") if random.random() < 0.70 else ("ДА", "НЕТ")

    for _ in range(150):
        op1 = random.choice([">", "<", ">=", "<="])
        op2 = random.choice([">", "<", ">=", "<="])
        logic = random.choice(["or", "and"])
        c1 = random.randint(1, 12)
        c2 = random.randint(1, 12)

        cond_str = f"({var1} {op1} {c1}) {logic} ({var2} {op2} {c2})"

        def eval_fn(v1, v2):
            b1 = compare_val(v1, op1, c1)
            b2 = compare_val(v2, op2, c2)
            return (b1 and b2) if logic == "and" else (b1 or b2)

        pairs = make_boundary_pairs(c1, c2)
        while len(pairs) < 9:
            v1 = random.randint(-12, 15)
            v2 = random.randint(-12, 15)
            if (v1, v2) not in pairs:
                pairs.append((v1, v2))

        random.shuffle(pairs)
        results = [eval_fn(v1, v2) for v1, v2 in pairs]
        yes_cnt = results.count(True)
        no_cnt = results.count(False)

        if not (2 <= yes_cnt <= 7):
            continue

        ask_yes = random.random() < 0.75
        target_word = word_yes if ask_yes else word_no
        ans = yes_cnt if ask_yes else no_cnt

        code_text = (
            f"{var1} = int(input())\n"
            f"{var2} = int(input())\n"
            f"if {cond_str}:\n"
            f"{INDENT}print(\"{word_yes}\")\n"
            f"else:\n"
            f"{INDENT}print(\"{word_no}\")"
        )

        prompt = (
            f"Ниже приведена программа, записанная на языке Python:\n"
            f"{code_text}\n"
            f"Было проведено 9 запусков программы, при которых в качестве значений переменных {var1} и {var2} "
            f"вводились следующие пары чисел ({var1}, {var2}): {format_pairs(pairs)}.\n"
            f"Сколько было запусков, при которых программа напечатала «{target_word}»?"
        )
        return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 2: УСЛОВИЯ С ОТРИЦАНИЕМ NOT (20% — примеры 17, 19, 20)
# =============================================================================

def generate_with_not():
    var1, var2 = ("s", "t") if random.random() < 0.80 else ("s", "k")
    word_yes, word_no = ("YES", "NO") if random.random() < 0.75 else ("ДА", "НЕТ")
    pattern = random.choice(["and_not", "not_or", "not_both_and", "not_both_or"])

    for _ in range(150):
        c1 = random.randint(-6, 10)
        c2 = random.randint(-4, 10)
        op1 = random.choice([">", "<", ">=", "<="])
        op2 = random.choice([">", "<", ">=", "<="])

        if pattern == "and_not":
            cond_str = f"({var1} {op1} {c1}) and not ({var2} {op2} {c2})"
            eval_fn = lambda v1, v2: compare_val(v1, op1, c1) and (not compare_val(v2, op2, c2))
        elif pattern == "not_or":
            cond_str = f"not ({var1} {op1} {c1}) or ({var2} {op2} {c2})"
            eval_fn = lambda v1, v2: (not compare_val(v1, op1, c1)) or compare_val(v2, op2, c2)
        elif pattern == "not_both_and":
            cond_str = f"not (({var1} {op1} {c1}) and ({var2} {op2} {c2}))"
            eval_fn = lambda v1, v2: not (compare_val(v1, op1, c1) and compare_val(v2, op2, c2))
        else:
            cond_str = f"not (({var1} {op1} {c1}) or ({var2} {op2} {c2}))"
            eval_fn = lambda v1, v2: not (compare_val(v1, op1, c1) or compare_val(v2, op2, c2))

        pairs = make_boundary_pairs(c1, c2)
        while len(pairs) < 9:
            v1 = random.randint(-14, 15)
            v2 = random.randint(-12, 14)
            if (v1, v2) not in pairs:
                pairs.append((v1, v2))

        random.shuffle(pairs)
        results = [eval_fn(v1, v2) for v1, v2 in pairs]
        yes_cnt = results.count(True)
        no_cnt = results.count(False)

        if not (2 <= yes_cnt <= 7):
            continue

        ask_yes = random.choice([True, False])
        target_word = word_yes if ask_yes else word_no
        ans = yes_cnt if ask_yes else no_cnt

        code_text = (
            f"{var1} = int(input())\n"
            f"{var2} = int(input())\n"
            f"if {cond_str}:\n"
            f"{INDENT}print(\"{word_yes}\")\n"
            f"else:\n"
            f"{INDENT}print(\"{word_no}\")"
        )

        prompt = (
            f"Ниже приведена программа, записанная на языке Python:\n"
            f"{code_text}\n"
            f"Было проведено 9 запусков программы, при которых в качестве значений переменных {var1} и {var2} "
            f"вводились следующие пары чисел ({var1}, {var2}): {format_pairs(pairs)}.\n"
            f"Сколько было запусков, при которых программа напечатала «{target_word}»?"
        )
        return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 3: ЦЕЛОЧИСЛЕННАЯ АРИФМЕТИКА //, %, * (15% — примеры 12, 15, 22)
# =============================================================================

def generate_arithmetic_cond():
    var1, var2 = "s", "k"
    word_yes, word_no = ("ДА", "НЕТ") if random.random() < 0.60 else ("YES", "NO")
    subtype = random.choices(["div_eq", "mod_eq", "mult_cmp"], weights=[0.35, 0.35, 0.30], k=1)[0]

    for _ in range(150):
        pairs = []
        if subtype == "div_eq":
            m = random.choice([2, 3, 4])
            cond_str = f"{var1} // {m} == {var2}"
            eval_fn = lambda v1, v2, m=m: (v1 // m) == v2

            want_true = random.randint(3, 6)
            while len(pairs) < want_true:
                v2 = random.randint(0, 7)
                v1 = v2 * m + random.randint(0, m - 1)
                if (v1, v2) not in pairs:
                    pairs.append((v1, v2))
            while len(pairs) < 9:
                v1 = random.randint(1, 25)
                v2 = random.randint(0, 10)
                if (v1 // m != v2) and (v1, v2) not in pairs:
                    pairs.append((v1, v2))

        elif subtype == "mod_eq":
            m = random.choice([3, 4, 5, 6])
            cond_str = f"{var1} % {m} == {var2}"
            eval_fn = lambda v1, v2, m=m: (v1 % m) == v2

            want_true = random.randint(3, 6)
            while len(pairs) < want_true:
                rem = random.randint(0, m - 1)
                v1 = random.randint(0, 5) * m + rem
                if (v1, rem) not in pairs:
                    pairs.append((v1, rem))
            while len(pairs) < 9:
                v1 = random.randint(1, 25)
                v2 = random.randint(0, m + 2)
                if (v1 % m != v2) and (v1, v2) not in pairs:
                    pairs.append((v1, v2))

        else: # mult_cmp (с обязательными пограничными точками s = m * k)
            m = random.choice([2, 3])
            op = random.choice([">=", "<=", ">", "<"])
            cond_str = f"{var1} {op} {m} * {var2}"
            eval_fn = lambda v1, v2, m=m, op=op: compare_val(v1, op, m * v2)

            k_b1 = random.randint(1, 5)
            k_b2 = random.randint(-4, -1)
            pairs = [(m * k_b1, k_b1), (m * k_b2 + random.choice([-1, 0, 1]), k_b2)]
            while len(pairs) < 9:
                v2 = random.randint(-6, 8)
                v1 = m * v2 + random.randint(-8, 8)
                if (v1, v2) not in pairs:
                    pairs.append((v1, v2))

        random.shuffle(pairs)
        results = [eval_fn(v1, v2) for v1, v2 in pairs]
        yes_cnt = results.count(True)
        no_cnt = results.count(False)

        if not (2 <= yes_cnt <= 7):
            continue

        ask_yes = random.random() < 0.80
        target_word = word_yes if ask_yes else word_no
        ans = yes_cnt if ask_yes else no_cnt

        code_text = (
            f"{var1} = int(input())\n"
            f"{var2} = int(input())\n"
            f"if {cond_str}:\n"
            f"{INDENT}print(\"{word_yes}\")\n"
            f"else:\n"
            f"{INDENT}print(\"{word_no}\")"
        )

        prompt = (
            f"Ниже приведена программа, записанная на языке Python:\n"
            f"{code_text}\n"
            f"Было проведено 9 запусков программы, при которых в качестве значений переменных {var1} и {var2} "
            f"вводились следующие пары чисел ({var1}, {var2}): {format_pairs(pairs)}.\n"
            f"Сколько было запусков, при которых программа напечатала «{target_word}»?"
        )
        return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 4: ЗАДАЧИ С ПАРАМЕТРОМ A (30% — примеры 9, 10, 16, 18, 21)
# =============================================================================

def generate_parameter_a():
    var1, var2 = "s", "t"
    word_yes, word_no = "YES", "NO"
    question_kind = random.choices(["count_a", "min_a", "max_a"], weights=[0.40, 0.30, 0.30], k=1)[0]

    for _ in range(200):
        a_on_first = random.choice([True, False])
        c_fixed = random.randint(6, 13)
        logic = random.choices(["or", "and"], weights=[0.75, 0.25], k=1)[0]
        op_a = random.choice([">", "<", ">=", "<="])
        op_c = random.choice([">", "<"])

        if a_on_first:
            cond_str = f"({var1} {op_a} A) {logic} ({var2} {op_c} {c_fixed})"
        else:
            cond_str = f"({var1} {op_c} {c_fixed}) {logic} ({var2} {op_a} A)"

        def eval_fn(v1, v2, a_val):
            val_a_var = v1 if a_on_first else v2
            val_c_var = v2 if a_on_first else v1
            b_a = compare_val(val_a_var, op_a, a_val)
            b_c = compare_val(val_c_var, op_c, c_fixed)
            return (b_a and b_c) if logic == "and" else (b_a or b_c)

        pairs = []
        while len(pairs) < 9:
            v1 = random.randint(-12, 15)
            v2 = random.randint(-12, 15)
            if (v1, v2) not in pairs:
                pairs.append((v1, v2))

        ask_yes = random.choice([True, False])
        target_word = word_yes if ask_yes else word_no
        target_k = random.randint(2, 8)

        # Вычисляем множество целых A на отрезке [-30, 30]
        valid_a = []
        for a_val in range(-30, 31):
            cnt = sum(1 for (v1, v2) in pairs if (eval_fn(v1, v2, a_val) if ask_yes else not eval_fn(v1, v2, a_val)))
            if cnt == target_k:
                valid_a.append(a_val)

        if not valid_a:
            continue

        has_left_bound = (-30 not in valid_a)
        has_right_bound = (30 not in valid_a)

        if question_kind == "count_a":
            if not (has_left_bound and has_right_bound):
                continue
            if not (2 <= len(valid_a) <= 12):
                continue
            ans = len(valid_a)
            q_line = (
                f"Укажите количество целых значений параметра A, при которых для указанных входных данных "
                f"программа напечатает «{target_word}» {TIMES_WORDS[target_k]}."
            )
        elif question_kind == "min_a":
            if not has_left_bound:
                continue
            ans = min(valid_a)
            q_line = (
                f"Укажите наименьшее целое значение параметра A, при котором для указанных входных данных "
                f"программа напечатает «{target_word}» {TIMES_WORDS[target_k]}."
            )
        else: # max_a
            if not has_right_bound:
                continue
            ans = max(valid_a)
            q_line = (
                f"Укажите наибольшее целое значение параметра A, при котором для указанных входных данных "
                f"программа напечатает «{target_word}» {TIMES_WORDS[target_k]}."
            )

        code_text = (
            f"{var1} = int(input())\n"
            f"{var2} = int(input())\n"
            f"A = int(input())\n"
            f"if {cond_str}:\n"
            f"{INDENT}print(\"{word_yes}\")\n"
            f"else:\n"
            f"{INDENT}print(\"{word_no}\")"
        )

        prompt = (
            f"Ниже приведена программа, записанная на языке Python:\n"
            f"{code_text}\n"
            f"Было проведено 9 запусков программы, при которых в качестве значений переменных {var1} и {var2} "
            f"вводились следующие пары чисел ({var1}, {var2}): {format_pairs(pairs)}.\n"
            f"{q_line}"
        )
        return prompt, str(ans)

    return None

# =============================================================================
# ТОЧКА ВХОДА ГЕНЕРАТОРА
# =============================================================================

def generate():
    random.seed(os.urandom(16))

    for _ in range(50):
        archetype = random.choices(
            ["simple_logic", "with_not", "arithmetic", "parameter_a"],
            weights=[0.35, 0.20, 0.15, 0.30],
            k=1
        )[0]

        if archetype == "simple_logic":
            res = generate_simple_logic()
        elif archetype == "with_not":
            res = generate_with_not()
        elif archetype == "arithmetic":
            res = generate_arithmetic_cond()
        else:
            res = generate_parameter_a()

        if res is not None:
            prompt, answer = res
            return {
                "task": prompt,
                "variants": None,
                "answer": answer
            }

    # Гарантированный детерминированный резервный вариант (fallback)
    return {
        "task": (
            "Ниже приведена программа, записанная на языке Python:\n"
            "s = int(input())\n"
            "t = int(input())\n"
            "if (s > 10) or (t > 10):\n"
            f"{INDENT}print(\"YES\")\n"
            "else:\n"
            f"{INDENT}print(\"NO\")\n"
            "Было проведено 9 запусков программы, при которых в качестве значений переменных s и t "
            "вводились следующие пары чисел (s, t): (1, 2); (11, 2); (1, 12); (11, 12); (-11, -12); (-11, 12); (-12, 11); (10, 10); (10, 5).\n"
            "Сколько было запусков, при которых программа напечатала «YES»?"
        ),
        "variants": None,
        "answer": "5"
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))