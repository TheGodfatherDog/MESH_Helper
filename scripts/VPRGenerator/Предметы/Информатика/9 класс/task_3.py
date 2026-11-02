import sys
import json
import random
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 3,
    "title": "Алгебра логики (наибольшее, наименьшее и количество чисел)"
}

# =============================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ФОРМИРОВАНИЯ НЕРАВЕНСТВ
# =============================================================================

def make_lower_bound(var, bound, inclusive, use_not):
    """
    Создаёт условие нижней границы:
    если inclusive=True  -> эквивалентно (x >= bound)
    если inclusive=False -> эквивалентно (x > bound)
    """
    if inclusive:
        text = f"НЕ ({var} < {bound})" if use_not else f"({var} ≥ {bound})"
        fn = lambda x, b=bound: x >= b
    else:
        text = f"НЕ ({var} ≤ {bound})" if use_not else f"({var} > {bound})"
        fn = lambda x, b=bound: x > b
    return text, fn

def make_upper_bound(var, bound, inclusive, use_not):
    """
    Создаёт условие верхней границы:
    если inclusive=True  -> эквивалентно (x <= bound)
    если inclusive=False -> эквивалентно (x < bound)
    """
    if inclusive:
        text = f"НЕ ({var} > {bound})" if use_not else f"({var} ≤ {bound})"
        fn = lambda x, b=bound: x <= b
    else:
        text = f"НЕ ({var} ≥ {bound})" if use_not else f"({var} < {bound})"
        fn = lambda x, b=bound: x < b
    return text, fn

def make_parity_cond(var, want_even, use_not):
    """Создаёт условие чётности/нечётности с возможным отрицанием."""
    if want_even:
        text = f"НЕ ({var} нечётное)" if use_not else f"({var} чётное)"
        fn = lambda x: x % 2 == 0
    else:
        text = f"НЕ ({var} чётное)" if use_not else f"({var} нечётное)"
        fn = lambda x: x % 2 != 0
    return text, fn

# =============================================================================
# АРХЕТИП 1: НАИБОЛЬШЕЕ ИЛИ НАИМЕНЬШЕЕ ЧИСЛО НА ИНТЕРВАЛЕ (30%)
# =============================================================================

def generate_interval_extremum():
    find_max = random.choice([True, False])
    extr_word = "наибольшее" if find_max else "наименьшее"
    var = random.choice(["x", "X"])

    subtype = random.choices(
        ["two_bounds", "bound_and_parity", "three_parts", "de_morgan", "false_stmt", "hole_or_split"],
        weights=[0.28, 0.22, 0.16, 0.12, 0.12, 0.10],
        k=1
    )[0]

    for _ in range(200):
        a = random.randint(3, 85)
        b = a + random.randint(5, 35)

        if subtype == "two_bounds":
            inc_low = random.choice([True, False])
            inc_high = random.choice([True, False])
            not_low = random.choice([True, False])
            not_high = random.choice([True, False])
            if not not_low and not not_high:
                not_low = True

            t1, f1 = make_lower_bound(var, a, inc_low, not_low)
            t2, f2 = make_upper_bound(var, b, inc_high, not_high)

            expr_text = f"{t1} И {t2}" if random.choice([True, False]) else f"{t2} И {t1}"
            matching = [x for x in range(-50, 250) if f1(x) and f2(x)]
            ans = max(matching) if find_max else min(matching)
            prompt = (
                f"Напишите {extr_word} целое число {var}, для которого истинно высказывание:\n"
                f"{expr_text}."
            )
            return prompt, str(ans)

        elif subtype == "bound_and_parity":
            want_even = random.choice([True, False])
            tp, fp = make_parity_cond(var, want_even, use_not=random.choice([True, False]))

            if find_max:
                tb, fb = make_upper_bound(var, b, inclusive=random.choice([True, False]), use_not=True)
                matching = [x for x in range(-50, 250) if fb(x) and fp(x)]
                ans = max(matching)
            else:
                tb, fb = make_lower_bound(var, a, inclusive=random.choice([True, False]), use_not=random.choice([True, False]))
                matching = [x for x in range(-50, 250) if fb(x) and fp(x)]
                ans = min(matching)

            expr_text = f"{tp} И {tb}" if random.choice([True, False]) else f"{tb} И {tp}"
            prompt = (
                f"Напишите {extr_word} целое число {var}, для которого истинно высказывание:\n"
                f"{expr_text}."
            )
            return prompt, str(ans)

        elif subtype == "three_parts":
            t1, f1 = make_lower_bound(var, a, inclusive=random.choice([True, False]), use_not=True)
            t2, f2 = make_upper_bound(var, b, inclusive=random.choice([True, False]), use_not=True)
            tp, fp = make_parity_cond(var, want_even=random.choice([True, False]), use_not=False)

            matching = [x for x in range(-50, 250) if f1(x) and f2(x) and fp(x)]
            if not matching:
                continue

            ans = max(matching) if find_max else min(matching)
            expr_text = f"{t1} И {t2} И {tp}"
            prompt = (
                f"Напишите {extr_word} целое число {var}, для которого истинно высказывание:\n"
                f"{expr_text}."
            )
            return prompt, str(ans)

        elif subtype == "de_morgan":
            expr_text = f"НЕ (({var} ≥ {b}) ИЛИ ({var} < {a}))"
            matching = [x for x in range(1, 250) if not ((x >= b) or (x < a))]
            if not matching:
                continue
            ans = max(matching) if find_max else min(matching)
            prompt = (
                f"Определите {extr_word} натуральное число {var}, для которого истинно логическое высказывание:\n"
                f"{expr_text}."
            )
            return prompt, str(ans)

        elif subtype == "false_stmt":
            if find_max:
                expr_text = f"НЕ ({var} < {a + 2}) ИЛИ (({var} < {a + 1}) И ({var} ≥ {a}))"
                matching = [x for x in range(1, 250) if not ((not (x < a + 2)) or ((x < a + 1) and (x >= a)))]
                ans = max(matching)
            else:
                if random.choice([True, False]):
                    expr_text = f"(НЕ ({var} ≥ {a + 1}) И НЕ ({var} = {a})) ИЛИ ({var} ≤ {b})"
                    matching = [x for x in range(1, 250) if not (((not (x >= a + 1)) and (x != a)) or (x <= b))]
                    ans = min(matching)
                else:
                    expr_text = f"({var} > {a + 1}) ИЛИ НЕ (({var} < {a + 2}) И ({var} > {a - 1}))"
                    matching = [x for x in range(1, 250) if not ((x > a + 1) or (not ((x < a + 2) and (x > a - 1))))]
                    ans = min(matching)

            prompt = (
                f"Напишите {extr_word} натуральное число {var}, для которого ЛОЖНО высказывание:\n"
                f"{expr_text}."
            )
            return prompt, str(ans)

        else: # hole_or_split
            if not find_max:
                if random.choice([True, False]):
                    expr_text = f"({var} > {a}) И (({var} < {a + 2}) ИЛИ ({var} > {a + 2}))"
                    matching = [x for x in range(1, 250) if (x > a) and ((x < a + 2) or (x > a + 2))]
                    ans = min(matching)
                else:
                    expr_text = f"({var} > {a}) И ({var} > {a + 1}) И ({var} ≠ {a + 2})"
                    matching = [x for x in range(1, 250) if (x > a) and (x > a + 1) and (x != a + 2)]
                    ans = min(matching)
                prompt = (
                    f"Напишите наименьшее натуральное число {var}, для которого ИСТИННО высказывание:\n"
                    f"{expr_text}."
                )
                return prompt, str(ans)
            else:
                expr_text = f"НЕ ({var} ≥ {b}) И ({var} ≠ {b - 1})"
                matching = [x for x in range(1, 250) if (not (x >= b)) and (x != b - 1)]
                ans = max(matching)
                prompt = (
                    f"Напишите наибольшее натуральное число {var}, для которого ИСТИННО высказывание:\n"
                    f"{expr_text}."
                )
                return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 2: ДВУЗНАЧНЫЕ И ТРЁХЗНАЧНЫЕ ЧИСЛА (ЦИФРЫ И ДЕЛИМОСТЬ) (22%)
# =============================================================================

def generate_digit_divisibility_extremum():
    find_max = random.choice([True, False])
    extr_word = "наибольшее" if find_max else "наименьшее"
    is_three_digit = random.choice([True, False])

    if is_three_digit:
        domain = list(range(100, 1000))
        num_kind = "трёхзначное число"
    else:
        domain = list(range(10, 100))
        num_kind = "двузначное число"

    subtype = random.choices(["first_digit_div", "even_div", "custom_bound"], weights=[0.50, 0.25, 0.25], k=1)[0]

    for _ in range(200):
        div_k = random.choice([3, 5, 7, 9])

        if subtype == "first_digit_div":
            first_odd = random.choice([True, False])
            use_not_first = random.choice([True, False])
            want_div = random.choice([True, False])

            if first_odd:
                t1 = "НЕ (первая цифра чётная)" if use_not_first else "(первая цифра нечётная)"
                f1 = lambda x: int(str(x)[0]) % 2 != 0
            else:
                t1 = "НЕ (первая цифра нечётная)" if use_not_first else "(первая цифра чётная)"
                f1 = lambda x: int(str(x)[0]) % 2 == 0

            if want_div:
                t2 = f"(число делится на {div_k})"
                f2 = lambda x, k=div_k: x % k == 0
            else:
                t2 = f"НЕ (число делится на {div_k})"
                f2 = lambda x, k=div_k: x % k != 0

            matching = [x for x in domain if f1(x) and f2(x)]
            if not matching:
                continue

            ans = max(matching) if find_max else min(matching)
            prompt = (
                f"Напишите {extr_word} натуральное {num_kind}, для которого истинно высказывание:\n"
                f"{t1} И {t2}."
            )
            return prompt, str(ans)

        elif subtype == "even_div":
            want_even = random.choice([True, False])
            tp, fp = make_parity_cond("Число", want_even, use_not=True)
            t2 = f"(Число кратно {div_k})"
            f2 = lambda x, k=div_k: x % k == 0

            matching = [x for x in domain if fp(x) and f2(x)]
            if not matching:
                continue

            ans = max(matching) if find_max else min(matching)
            prompt = (
                f"Напишите {extr_word} натуральное {num_kind}, для которого ИСТИННО высказывание:\n"
                f"{tp} И {t2}."
            )
            return prompt, str(ans)

        else: # custom_bound — все 4 комбинации (find_max × is_three_digit)
            want_even = random.choice([True, False])
            tp, fp = make_parity_cond("Число", want_even, use_not=True)

            if find_max and not is_three_digit:
                limit_val = random.randint(35, 85)
                big_bound = limit_val + random.randint(10, 25)
                matching = [x for x in domain if x < limit_val and x < big_bound and fp(x)]
                ans = max(matching)
                prompt = (
                    f"Напишите наибольшее двузначное число, меньшее {limit_val}, для которого ИСТИННО высказывание:\n"
                    f"(Число < {big_bound}) И {tp}."
                )
                return prompt, str(ans)

            elif not find_max and not is_three_digit:
                limit_val = random.randint(20, 75)
                small_bound = random.randint(5, limit_val - 5)
                parity_word = "чётное" if want_even else "нечётное"
                # ЛОЖНО: НЕ (Число > small_bound) ИЛИ (Число чётное/нечётное)
                matching = [
                    x for x in domain
                    if x > limit_val and not ((not (x > small_bound)) or ((x % 2 == 0) if want_even else (x % 2 != 0)))
                ]
                ans = min(matching)
                prompt = (
                    f"Напишите наименьшее двузначное число, большее {limit_val}, для которого ЛОЖНО высказывание:\n"
                    f"НЕ (Число > {small_bound}) ИЛИ (Число {parity_word})."
                )
                return prompt, str(ans)

            elif find_max and is_three_digit:
                limit_val = random.randint(250, 850)
                big_bound = limit_val + random.randint(40, 120)
                matching = [x for x in domain if x < limit_val and x < big_bound and fp(x)]
                ans = max(matching)
                prompt = (
                    f"Напишите наибольшее трёхзначное число, меньшее {limit_val}, для которого ИСТИННО высказывание:\n"
                    f"(Число < {big_bound}) И {tp}."
                )
                return prompt, str(ans)

            else: # not find_max and is_three_digit
                limit_val = random.randint(121, 750)
                small_bound = random.choice([50, 60, 80, 90])
                parity_word = "чётное" if want_even else "нечётное"
                matching = [
                    x for x in domain
                    if x > limit_val and not ((not (x > small_bound)) or ((x % 2 == 0) if want_even else (x % 2 != 0)))
                ]
                ans = min(matching)
                prompt = (
                    f"Напишите наименьшее трёхзначное число, большее {limit_val}, для которого ЛОЖНО высказывание:\n"
                    f"НЕ (Число > {small_bound}) ИЛИ (Число {parity_word})."
                )
                return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 3: ПОДСЧЁТ КОЛИЧЕСТВА ЧИСЕЛ (18%)
# =============================================================================

def generate_count_numbers():
    subtype = random.choices(
        ["nat_parity", "de_morgan_count", "two_digit_false", "two_digit_true", "three_digit_ends"],
        weights=[0.22, 0.26, 0.20, 0.16, 0.16],
        k=1
    )[0]

    if subtype == "nat_parity":
        bound = random.randint(15, 75)
        want_odd = random.choice([True, False])
        parity_word = "чётное" if want_odd else "нечётное"
        matching = [
            x for x in range(1, bound + 50)
            if (not (x > bound)) and (x % 2 != 0 if want_odd else x % 2 == 0)
        ]
        prompt = (
            f"Напишите количество натуральных чисел, для которых истинно высказывание:\n"
            f"НЕ (Число > {bound}) И НЕ (Число {parity_word})."
        )
        return prompt, str(len(matching))

    elif subtype == "de_morgan_count":
        a = random.randint(12, 45)
        b = a + random.randint(12, 40)
        with_parity = random.choice([True, False])

        if with_parity:
            want_even = random.choice([True, False])
            p_word = "чётное" if want_even else "нечётное"
            matching = [
                x for x in range(1, 200)
                if (not ((x >= b) or (x < a))) and (x % 2 == 0 if want_even else x % 2 != 0)
            ]
            expr_text = f"НЕ ((x ≥ {b}) ИЛИ (x < {a})) И (x {p_word})"
        else:
            matching = [x for x in range(1, 200) if not ((x >= b) or (x < a))]
            expr_text = f"НЕ ((x ≥ {b}) ИЛИ (x < {a}))"

        prompt = (
            f"Определите количество натуральных чисел x, для которых истинно логическое выражение:\n"
            f"{expr_text}."
        )
        return prompt, str(len(matching))

    elif subtype == "two_digit_false":
        div_k = random.choice([7, 9, 11, 13, 15, 17, 19])
        parity_word = random.choice(["чётное", "нечётное"])
        is_even_word = (parity_word == "чётное")

        matching = [
            x for x in range(10, 100)
            if not ((not (x % 2 == 0 if is_even_word else x % 2 != 0)) and (not (x % div_k == 0)))
        ]
        prompt = (
            f"Определите количество натуральных двузначных чисел x, для которых ЛОЖНО логическое высказывание:\n"
            f"НЕ (x {parity_word}) И НЕ (x кратно {div_k})."
        )
        return prompt, str(len(matching))

    elif subtype == "two_digit_true":
        b = random.randint(35, 92)
        parity_word = random.choice(["чётное", "нечётное"])
        is_even_word = (parity_word == "чётное")

        matching = [
            x for x in range(10, 100)
            if (not (x % 2 == 0 if is_even_word else x % 2 != 0)) and (not (x > b))
        ]
        prompt = (
            f"Определите количество натуральных двузначных чисел x, для которых истинно логическое выражение:\n"
            f"НЕ (x {parity_word}) И НЕ (x > {b})."
        )
        return prompt, str(len(matching))

    else: # three_digit_ends (гарантированно >= 2 подходящих чисел)
        digit = random.randint(1, 9)
        b = random.randint(130, 320)
        matching = [x for x in range(100, 1000) if (x % 10 == digit) and (not (x > b))]
        prompt = (
            f"Определите количество натуральных трёхзначных чисел x, для которых истинно логическое выражение:\n"
            f"(x оканчивается на {digit}) И НЕ (x > {b})."
        )
        return prompt, str(len(matching))

# =============================================================================
# АРХЕТИП 4: ЕДИНСТВЕННОЕ ЧИСЛО X (УЗКИЙ ИНТЕРВАЛ) (15%)
# =============================================================================

def generate_single_value():
    target = random.randint(4, 140)
    var = random.choice(["X", "x"])
    pattern = random.choice(["true_lt", "true_gt", "false_gt", "false_lt"])

    if pattern == "true_lt":
        expr_text = f"({var} < {target + 1}) И НЕ ({var} < {target})"
        is_true = True
    elif pattern == "true_gt":
        expr_text = f"НЕ ({var} > {target}) И ({var} > {target - 1})"
        is_true = True
    elif pattern == "false_gt":
        expr_text = f"({var} > {target}) ИЛИ НЕ ({var} > {target - 1})"
        is_true = False
    else:
        expr_text = f"({var} < {target}) ИЛИ НЕ ({var} < {target + 1})"
        is_true = False

    truth_word = "ИСТИННО" if is_true else "ЛОЖНО"
    prompt = (
        f"Для какого целого числа {var} {truth_word} высказывание:\n"
        f"{expr_text}?"
    )

    return prompt, str(target)

# =============================================================================
# АРХЕТИП 5: ВЫБОР ОДНОГО ЧИСЛА ИЗ ЧЕТЫРЁХ ДАННЫХ (15%)
# =============================================================================

def generate_choose_from_four():
    subtype = random.choice(["three_digit_props", "mixed_magnitude"])

    for _ in range(200):
        if subtype == "three_digit_props":
            nums = random.sample(range(111, 989), 4)
            first_even = random.choice([True, False])
            sum_even = random.choice([True, False])

            t1 = "НЕ (Первая цифра нечётная)" if first_even else "НЕ (Первая цифра чётная)"
            t2 = "(Сумма цифр чётная)" if sum_even else "(Сумма цифр нечётная)"

            matching = [
                n for n in nums
                if ((int(str(n)[0]) % 2 == 0) == first_even)
                and ((sum(int(d) for d in str(n)) % 2 == 0) == sum_even)
            ]

            if len(matching) == 1:
                nums_str = ", ".join(str(n) for n in nums)
                prompt = (
                    f"Дано четыре числа: {nums_str}. Для какого из приведённых чисел истинно высказывание:\n"
                    f"{t1} И {t2}? В ответе запишите само это число."
                )
                return prompt, str(matching[0])

        else:
            bound = random.choice([100, 500, 1000])
            want_even = random.choice([True, False])

            n_small1 = random.randint(12, bound - 2)
            n_small2 = random.randint(12, bound - 2)
            n_big1 = random.randint(bound + 5, bound * 9)
            n_big2 = random.randint(bound + 5, bound * 9)

            nums = [n_small1, n_small2, n_big1, n_big2]
            if len(set(nums)) != 4:
                continue

            random.shuffle(nums)
            tp, fp = make_parity_cond("Число", want_even, use_not=True)
            matching = [n for n in nums if (n > bound) and fp(n)]

            if len(matching) == 1:
                nums_str = ", ".join(str(n) for n in nums)
                prompt = (
                    f"Дано четыре числа: {nums_str}. Для какого из приведённых чисел истинно высказывание:\n"
                    f"(Число > {bound}) И {tp}? В ответе запишите само это число."
                )
                return prompt, str(matching[0])

    return None

# =============================================================================
# ТОЧКА ВХОДА ГЕНЕРАТОРА
# =============================================================================

def generate():
    random.seed(os.urandom(16))

    while True:
        archetype = random.choices(
            ["interval_extr", "digits_div", "count_nums", "single_val", "choose_four"],
            weights=[0.30, 0.22, 0.18, 0.15, 0.15],
            k=1
        )[0]

        if archetype == "interval_extr":
            res = generate_interval_extremum()
        elif archetype == "digits_div":
            res = generate_digit_divisibility_extremum()
        elif archetype == "count_nums":
            res = generate_count_numbers()
        elif archetype == "single_val":
            res = generate_single_value()
        else:
            res = generate_choose_from_four()

        if res is not None:
            prompt, answer = res
            return {
                "task": prompt,
                "answer": answer
            }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))