import sys
import json
import random
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 10,
    "title": "Системы счисления (перевод, подсчёт единиц, сравнение и выражения)",
    "has_variants": False
}

# =============================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =============================================================================

def to_repr(val, base):
    """Форматирует число с нижним индексом основания системы счисления."""
    if base == 2:
        return f"{bin(val)[2:]}₂"
    if base == 8:
        return f"{oct(val)[2:]}₈"
    if base == 16:
        return f"{hex(val)[2:].upper()}₁₆"
    if base == 10:
        return f"{val}₁₀"
    return str(val)

# =============================================================================
# АРХЕТИП 1: ПЕРЕВОД ДВОИЧНАЯ <-> ДЕСЯТИЧНАЯ СС (24% — блок 1)
# =============================================================================

def generate_bin_dec_convert():
    val = random.randint(45, 245)
    bin_str = bin(val)[2:]

    if random.choice([True, False]):
        phrasings = [
            f"Переведите двоичное число {bin_str} в десятичную систему счисления.",
            f"Некоторое число в двоичной системе счисления записывается как {bin_str}. Запишите это число в десятичной системе счисления.",
            f"Переведите число {bin_str} из двоичной системы счисления в десятичную систему счисления. В ответе напишите полученное число."
        ]
        return random.choice(phrasings), str(val)
    else:
        phrasings = [
            f"Переведите число {val} из десятичной системы счисления в двоичную систему счисления. В ответе укажите двоичное число. Основание системы счисления указывать не нужно.",
            f"Переведите десятичное число {val} в двоичную систему счисления. Основание системы счисления писать не нужно."
        ]
        return random.choice(phrasings), bin_str

# =============================================================================
# АРХЕТИП 2: КОЛИЧЕСТВО ЕДИНИЦ В ДВОИЧНОЙ ЗАПИСИ ЧИСЛА (18% — блок 2)
# =============================================================================

def generate_count_ones():
    for _ in range(100):
        val = random.randint(55, 245)
        bin_str = bin(val)[2:]
        ones = bin_str.count("1")
        if 2 <= ones <= len(bin_str) - 1:
            phrasings = [
                f"Переведите число {val} из десятичной системы счисления в двоичную систему счисления. "
                "Сколько единиц содержит полученное число? В ответе укажите одно число — количество единиц.",
                f"Переведите число {val} из десятичной в двоичную систему счисления. Сколько единиц содержит полученное число?"
            ]
            return random.choice(phrasings), str(ones)
    return None

# =============================================================================
# АРХЕТИП 3: СРАВНЕНИЕ ТРЁХ ЧИСЕЛ ПО ЗАПИСИ В 2-Й ИЛИ 8-Й СС (20% — блок 2)
# =============================================================================

def generate_compare_three_props():
    is_octal_sum = random.choice([True, False])
    find_min = random.random() < 0.75

    for _ in range(150):
        base_val = random.randint(55, 130)
        offsets = random.sample(range(-25, 30), 3)
        nums = sorted([base_val + d for d in offsets])

        if nums[0] < 35:
            continue

        if is_octal_sum:
            metrics = [sum(int(ch) for ch in oct(n)[2:]) for n in nums]
            if len(set(metrics)) != 3:
                continue

            extr_word = "наименьшая" if find_min else "наибольшая"
            ans = min(metrics) if find_min else max(metrics)
            nums_line = f"{to_repr(nums[0], 10)},  {to_repr(nums[1], 10)},  {to_repr(nums[2], 10)}."

            prompt = (
                "Среди приведённых ниже трёх чисел, записанных в десятичной системе счисления, "
                f"найдите число, сумма цифр которого в восьмеричной записи {extr_word}. "
                "В ответе запишите сумму цифр в восьмеричной записи этого числа:\n"
                f"{nums_line}"
            )
            return prompt, str(ans)

        else:
            metrics = [bin(n)[2:].count("1") for n in nums]
            if len(set(metrics)) != 3:
                continue

            extr_word = "наименьшее" if find_min else "наибольшее"
            ans = min(metrics) if find_min else max(metrics)
            nums_line = f"{to_repr(nums[0], 10)},  {to_repr(nums[1], 10)},  {to_repr(nums[2], 10)}."

            prompt = (
                "Среди приведённых ниже трёх чисел, записанных в десятичной системе счисления, "
                f"найдите число, в двоичной записи которого {extr_word} количество единиц. "
                "В ответе запишите количество единиц в двоичной записи этого числа:\n"
                f"{nums_line}"
            )
            return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 4: АРИФМЕТИЧЕСКОЕ ВЫРАЖЕНИЕ В ТРЁХ СС (22% — примеры 6, 8–10, 12, 15, 16)
# =============================================================================

OCT_BINARY_LIKE = [int(s, 8) for s in ["1001", "1010", "1011", "1100", "1101", "1110", "1111", "101", "110", "111"]]
HEX_BINARY_LIKE = [int(s, 16) for s in ["100", "101", "110", "111", "10", "11"]]

def generate_three_bases_expr():
    use_binary_like_trap = random.random() < 0.75
    is_sub = random.random() < 0.30

    for _ in range(100):
        v_bin = random.randint(45, 250)

        if use_binary_like_trap:
            v_oct = random.choice(OCT_BINARY_LIKE)
            v_hex = random.choice(HEX_BINARY_LIKE)
        else:
            v_oct = random.randint(65, 450)
            v_hex = random.randint(45, 350)

        if is_sub:
            ans = v_bin + v_oct - v_hex
            op_sym = "−"
        else:
            ans = v_bin + v_oct + v_hex
            op_sym = "+"

        if not (50 <= ans <= 1400):
            continue

        expr_str = f"{to_repr(v_bin, 2)} + {to_repr(v_oct, 8)} {op_sym} {to_repr(v_hex, 16)}"
        prompt = (
            f"Вычислите значение арифметического выражения: {expr_str}.\n"
            "В ответе запишите десятичное число, основание системы счисления указывать не нужно."
        )
        return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 5: МАКСИМАЛЬНОЕ ИЛИ МИНИМАЛЬНОЕ ИЗ ТРЁХ ЧИСЕЛ В РАЗНЫХ СС (16%)
# =============================================================================

def generate_min_max_three_bases():
    find_max = random.choice([True, False])
    extr_word = "максимальное" if find_max else "минимальное"

    for _ in range(100):
        center = random.randint(45, 180)
        diffs = random.sample([-14, -9, -5, -2, 2, 5, 9, 14], 3)
        vals = [center + d for d in diffs]

        if min(vals) <= 15:
            continue

        reprs = [
            to_repr(vals[0], 16),
            to_repr(vals[1], 8),
            to_repr(vals[2], 2)
        ]

        ans = max(vals) if find_max else min(vals)
        nums_line = f"{reprs[0]},  {reprs[1]},  {reprs[2]}."

        prompt = (
            "Среди приведённых ниже трёх чисел, записанных в различных системах счисления, "
            f"найдите {extr_word} и запишите его в ответе в десятичной системе счисления. "
            "Основание системы счисления указывать не нужно:\n"
            f"{nums_line}"
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
            ["bin_dec", "count_ones", "compare_props", "three_expr", "min_max_bases"],
            weights=[0.24, 0.18, 0.20, 0.22, 0.16],
            k=1
        )[0]

        if archetype == "bin_dec":
            res = generate_bin_dec_convert()
        elif archetype == "count_ones":
            res = generate_count_ones()
        elif archetype == "compare_props":
            res = generate_compare_three_props()
        elif archetype == "three_expr":
            res = generate_three_bases_expr()
        else:
            res = generate_min_max_three_bases()

        if res is not None:
            prompt, answer = res
            return {
                "task": prompt,
                "variants": None,
                "answer": answer
            }

    # Рандомизированный резервный вариант (fallback)
    fb_val = random.randint(65, 220)
    return {
        "task": f"Переведите двоичное число {bin(fb_val)[2:]} в десятичную систему счисления.",
        "variants": None,
        "answer": str(fb_val)
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))