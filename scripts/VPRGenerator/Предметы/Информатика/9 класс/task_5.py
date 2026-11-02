import sys
import json
import random
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 5,
    "title": "Анализ и построение алгоритмов для исполнителей (параметр b, Квадратор)",
    "has_variants": False
}

# =============================================================================
# ВСПОМОГАТЕЛЬНЫЙ ПОИСК ВСЕХ ПРОГРАММ (ГАРАНТИЯ ЕДИНСТВЕННОСТИ ОТВЕТА)
# =============================================================================

def find_all_programs(start, target, f1, f2, max_len=5):
    """
    Находит все последовательности команд длины <= max_len, переводящие
    число start в число target. Позволяет гарантировать строго 1 решение.
    """
    solutions = []
    queue = [(start, "")]

    while queue:
        curr, path = queue.pop(0)
        if curr == target and len(path) > 0:
            solutions.append(path)
            continue
        if len(path) >= max_len:
            continue

        for cmd_char, fn in (("1", f1), ("2", f2)):
            nxt = fn(curr)
            if nxt is not None and isinstance(nxt, int) and 0 < nxt <= 5000:
                queue.append((nxt, path + cmd_char))

    return solutions

# =============================================================================
# АРХЕТИП 1: НАЙТИ ПАРАМЕТР B (ОДНО УМНОЖЕНИЕ ИЛИ ДЕЛЕНИЕ НА B) (30%)
# =============================================================================

def generate_find_b_linear():
    name = random.choice(["Альфа", "Бета", "Гамма", "Омега", "Сигма"])
    is_div = random.random() < 0.45
    patterns = ["11211", "12111", "11121", "1211", "1121"]

    for _ in range(150):
        d = random.randint(1, 6)
        b = random.randint(3, 16)
        prog = random.choice(patterns)

        if not is_div:
            # 1. прибавь d;  2. умножь на b
            start = random.randint(1, 10)
            curr = start
            for ch in prog:
                curr = (curr + d) if ch == "1" else (curr * b)
            target = curr

            # Проверяем единственность натурального b >= 2
            valid_b = []
            for tb in range(2, 80):
                val = start
                for ch in prog:
                    val = (val + d) if ch == "1" else (val * tb)
                if val == target:
                    valid_b.append(tb)

            if len(valid_b) == 1 and valid_b[0] == b:
                prompt = (
                    f"У исполнителя {name} две команды, которым присвоены номера: "
                    f"1. прибавь {d};  2. умножь на b (b — неизвестное натуральное число; b ≥ 2).\n"
                    f"Выполняя первую из них, {name} увеличивает число на экране на {d}, а выполняя вторую, умножает это число на b.\n"
                    f"Известно, что программа {prog} переводит число {start} в число {target}. Определите значение b."
                )
                return prompt, str(b)

        else:
            # 1. прибавь d;  2. раздели на b
            c1_before = prog.index("2")
            quotient = random.randint(2, 12)
            pre_div = b * quotient
            start = pre_div - c1_before * d
            if start <= 0:
                continue

            c1_after = len(prog) - c1_before - 1
            target = quotient + c1_after * d

            valid_b = []
            for tb in range(2, 100):
                val = start
                ok = True
                for ch in prog:
                    if ch == "1":
                        val += d
                    else:
                        if val % tb != 0:
                            ok = False
                            break
                        val //= tb
                if ok and val == target:
                    valid_b.append(tb)

            if len(valid_b) == 1 and valid_b[0] == b:
                prompt = (
                    f"У исполнителя {name} две команды, которым присвоены номера: "
                    f"1. прибавь {d};  2. раздели на b (b — неизвестное натуральное число; b ≥ 2).\n"
                    f"Выполняя первую из них, {name} увеличивает число на экране на {d}, а выполняя вторую, делит это число на b.\n"
                    f"Известно, что программа {prog} переводит число {start} в число {target}. Определите значение b."
                )
                return prompt, str(b)

    return None

# =============================================================================
# АРХЕТИП 2: НАЙТИ ПАРАМЕТР B (КВАДРАТНОЕ ИЛИ СОСТАВНОЕ УРАВНЕНИЕ) (22%)
# =============================================================================

def generate_find_b_equation():
    subtype = random.choices(["quad_mul_b", "sub_b_multi", "sq_add_b"], weights=[0.40, 0.35, 0.25], k=1)[0]

    for _ in range(150):
        if subtype == "quad_mul_b":
            # Примеры вида №12: 1. умножь на b; 2. прибавь d (программа 12221 или 12212)
            d = random.randint(1, 4)
            b = random.randint(2, 9)
            start = random.randint(1, 4)
            prog = random.choice(["12221", "12212", "12122"])

            def sim(tb):
                v = start
                for ch in prog:
                    v = (v * tb) if ch == "1" else (v + d)
                return v

            target = sim(b)
            if target > 400:
                continue

            valid_b = [tb for tb in range(1, 60) if sim(tb) == target]
            if len(valid_b) == 1 and valid_b[0] == b:
                prompt = (
                    f"У исполнителя Вычислитель две команды, которым присвоены номера: "
                    f"1. умножь на b;  2. прибавь {d} (b — неизвестное натуральное число).\n"
                    f"Первая из них увеличивает число на экране в b раз, вторая увеличивает его на {d}.\n"
                    f"Известно, что программа {prog} переводит число {start} в число {target}. Определите значение b."
                )
                return prompt, str(b)

        elif subtype == "sub_b_multi":
            # Примеры №8 и №13: вычитание b несколько раз + умножение на константу m
            m = random.choice([3, 4, 5])
            b = random.randint(2, 7)
            start = random.randint(2, 6)
            swap = random.choice([True, False])
            prog = random.choice(["21121", "21122", "12112"] if not swap else ["12212", "12211", "21221"])

            def sim(tb):
                v = start
                for ch in prog:
                    if (ch == "1" and not swap) or (ch == "2" and swap):
                        v -= tb
                    else:
                        v *= m
                return v

            target = sim(b)
            if target <= 0 or target > 300:
                continue

            valid_b = [tb for tb in range(1, 60) if sim(tb) == target]
            if len(valid_b) == 1 and valid_b[0] == b:
                m_word = "раза" if m in (3, 4) else "раз"
                if not swap:
                    c1, c2 = "вычти b", f"умножь на {m}"
                    d1, d2 = "уменьшает число на экране на b", f"увеличивает его в {m} {m_word}"
                else:
                    c1, c2 = f"умножь на {m}", "вычти b"
                    d1, d2 = f"увеличивает число на экране в {m} {m_word}", "уменьшает его на b"

                prompt = (
                    f"У исполнителя Вычислитель две команды, которым присвоены номера: "
                    f"1. {c1};  2. {c2} (b — неизвестное натуральное число).\n"
                    f"Первая из них {d1}, вторая — {d2}.\n"
                    f"Известно, что программа {prog} переводит число {start} в число {target}. Определите значение b."
                )
                return prompt, str(b)

        else: # sq_add_b (Пример №11: 1. возведи в квадрат; 2. прибавь b)
            b = random.randint(1, 5)
            start = random.randint(1, 3)
            prog = random.choice(["12212", "12122", "21212"])

            def sim(tb):
                v = start
                for ch in prog:
                    v = (v * v) if ch == "1" else (v + tb)
                return v

            target = sim(b)
            if target > 350:
                continue

            valid_b = [tb for tb in range(1, 50) if sim(tb) == target]
            if len(valid_b) == 1 and valid_b[0] == b:
                prompt = (
                    "У исполнителя Квадратор две команды, которым присвоены номера: "
                    "1. возведи в квадрат;  2. прибавь b (b — неизвестное натуральное число).\n"
                    "Первая из них возводит число на экране во вторую степень, вторая прибавляет к числу b.\n"
                    f"Известно, что программа {prog} переводит число {start} в число {target}. Определите значение b."
                )
                return prompt, str(b)

    return None

# =============================================================================
# АРХЕТИП 3: СОСТАВИТЬ ПРОГРАММУ (АРИФМЕТИКА: УМНОЖЕНИЕ / ДЕЛЕНИЕ) (18%)
# =============================================================================

def generate_build_arithmetic():
    is_div = random.random() < 0.35

    for _ in range(150):
        if not is_div:
            m = random.choice([2, 3, 4])
            a = random.choice([1, 2, 3])
            is_sub = random.choice([True, False])
            swap = random.choice([True, False])

            m_word = "раза"
            op_mul = lambda x, m=m: x * m
            op_add = (lambda x, a=a: x - a) if is_sub else (lambda x, a=a: x + a)

            t_mul = f"умножь на {m}"
            t_add = f"вычти {a}" if is_sub else f"прибавь {a}"
            d_mul = f"увеличивает число на экране в {m} {m_word}"
            d_add = f"уменьшает его на {a}" if is_sub else f"увеличивает его на {a}"

            if swap:
                cmd1, cmd2, f1, f2, d1, d2 = t_add, t_mul, op_add, op_mul, d_add, d_mul
            else:
                cmd1, cmd2, f1, f2, d1, d2 = t_mul, t_add, op_mul, op_add, d_mul, d_add

            start = random.randint(2, 6)
            curr = start
            for _ in range(5):
                curr = f1(curr) if random.choice([True, False]) else f2(curr)

            if curr <= 0 or curr == start or curr > 250:
                continue

            sols = find_all_programs(start, curr, f1, f2, max_len=5)
            if len(sols) == 1 and len(sols[0]) == 5:
                prompt = (
                    f"У исполнителя Вычислитель две команды, которым присвоены номера: 1. {cmd1};  2. {cmd2}.\n"
                    f"Первая из них {d1}, вторая — {d2}.\n"
                    f"Составьте алгоритм получения из числа {start} числа {curr}, содержащий не более 5 команд. В ответе запишите только номера команд."
                )
                return prompt, sols[0]

        else:
            # Исполнитель Делитель (Пример №7 блока 2)
            m = random.choice([2, 3])
            a = random.choice([1, 2, 3, 4])
            swap = random.choice([True, False])

            op_div = lambda x, m=m: (x // m) if (x % m == 0) else None
            op_sub = lambda x, a=a: x - a

            t_div, t_sub = f"раздели на {m}", f"вычти {a}"
            d_div, d_sub = f"уменьшает число на экране в {m} раза", f"уменьшает его на {a}"

            if swap:
                cmd1, cmd2, f1, f2, d1, d2 = t_sub, t_div, op_sub, op_div, d_sub, d_div
            else:
                cmd1, cmd2, f1, f2, d1, d2 = t_div, t_sub, op_div, op_sub, d_div, d_sub

            target = random.randint(3, 12)
            curr = target
            for _ in range(5):
                curr = (curr * m) if random.choice([True, False]) else (curr + a)
            start = curr

            if start <= target or start > 180:
                continue

            sols = find_all_programs(start, target, f1, f2, max_len=5)
            if len(sols) == 1 and len(sols[0]) == 5:
                prompt = (
                    f"У исполнителя Делитель две команды, которым присвоены номера: 1. {cmd1};  2. {cmd2}.\n"
                    f"Первая из них {d1}, вторая — {d2}. Исполнитель работает только с натуральными числами.\n"
                    f"Составьте алгоритм получения из числа {start} числа {target}, содержащий не более 5 команд. В ответе запишите только номера команд."
                )
                return prompt, sols[0]

    return None

# =============================================================================
# АРХЕТИП 4: СОСТАВИТЬ ПРОГРАММУ (КВАДРАТОР) (15%)
# =============================================================================

def generate_build_quadrator():
    for _ in range(150):
        a = random.choice([1, 2, 3, 4, 5])
        is_sub = random.choice([True, False])
        swap = random.choice([True, False])

        op_sq = lambda x: x * x
        op_add = (lambda x, a=a: x - a) if is_sub else (lambda x, a=a: x + a)

        t_sq = "возведи в квадрат"
        t_add = f"вычти {a}" if is_sub else f"прибавь {a}"
        d_sq = "возводит число на экране во вторую степень"
        d_add = f"уменьшает его на {a}" if is_sub else f"увеличивает его на {a}"

        if swap:
            cmd1, cmd2, f1, f2, d1, d2 = t_add, t_sq, op_add, op_sq, d_add, d_sq
        else:
            cmd1, cmd2, f1, f2, d1, d2 = t_sq, t_add, op_sq, op_add, d_sq, d_add

        start = random.randint(1, 5)
        curr = start
        sq_cnt = 0
        valid = True
        for _ in range(5):
            if sq_cnt < 2 and curr <= 14 and random.random() < 0.45:
                curr = curr * curr
                sq_cnt += 1
            else:
                curr = op_add(curr)
                if curr <= 0:
                    valid = False
                    break

        if not valid or sq_cnt < 1 or curr == start or curr > 250:
            continue

        sols = find_all_programs(start, curr, f1, f2, max_len=5)
        if len(sols) == 1 and len(sols[0]) == 5:
            prompt = (
                f"У исполнителя Квадратор две команды, которым присвоены номера: 1. {cmd1};  2. {cmd2}.\n"
                f"Первая из них {d1}, вторая — {d2}.\n"
                f"Составьте алгоритм получения из числа {start} числа {curr}, содержащий не более 5 команд. В ответе запишите только номера команд."
            )
            return prompt, sols[0]

    return None

# =============================================================================
# АРХЕТИП 5: ПОРАЗРЯДНЫЕ ОПЕРАЦИИ С ЦИФРАМИ (ЗАЧЕРКНИ / ПРИПИСАТЬ) (15%)
# =============================================================================

def generate_digit_operations():
    subtype = random.choices(
        ["sq_del_right", "sq_del_left", "append_div", "sub_append"],
        weights=[0.30, 0.25, 0.25, 0.20],
        k=1
    )[0]

    for _ in range(200):
        swap = random.choice([True, False])

        if subtype == "sq_del_right":
            # Примеры №16 и №8 блока 2: возведи в квадрат + зачеркни справа
            op1 = lambda x: (x * x) if x <= 90 else None
            op2 = lambda x: (x // 10) if x >= 10 else None
            t1, t2 = "возведи в квадрат", "зачеркни справа"
            d1, d2 = "возводит число на экране во вторую степень", "удаляет крайнюю правую цифру числа"
            exec_name = "Квадратор"
            start = random.randint(2, 9)

        elif subtype == "sq_del_left":
            # Пример №22: зачеркни слева + возведи в квадрат
            def del_left(x):
                s = str(x)
                if len(s) < 2:
                    return None
                rem = int(s[1:])
                return rem if rem > 0 else None

            op1 = del_left
            op2 = lambda x: (x * x) if x <= 90 else None
            t1, t2 = "зачеркни слева", "возведи в квадрат"
            d1, d2 = "удаляет крайнюю левую цифру числа на экране", "возводит число во вторую степень"
            exec_name = "Квадратор"
            start = random.randint(4, 14)

        elif subtype == "append_div":
            # Пример №20: приписать d + разделить на m
            digit = random.choice([1, 2, 4, 5])
            m = random.choice([2, 3])
            op1 = lambda x, d=digit: (x * 10 + d) if x <= 200 else None
            op2 = lambda x, m=m: (x // m) if (x % m == 0) else None
            t1, t2 = f"приписать {digit}", f"разделить на {m}"
            d1, d2 = f"приписывает к числу справа {digit}", f"уменьшает его в {m} раза"
            exec_name = "Вычислитель"
            start = random.randint(2, 12)

        else: # sub_append (Пример №21: вычесть a + приписать d)
            a = random.choice([3, 4, 5, 6])
            digit = random.choice([1, 2, 3, 4])
            op1 = lambda x, a=a: (x - a) if x > a else None
            op2 = lambda x, d=digit: (x * 10 + d) if x <= 9 else None
            t1, t2 = f"вычесть {a}", f"приписать {digit}"
            d1, d2 = f"уменьшает число на {a}", f"приписывает к нему справа {digit}"
            exec_name = "Вычислитель"
            start = random.randint(a + 2, a + 10)

        if swap:
            cmd1, cmd2, f1, f2, desc1, desc2 = t2, t1, op2, op1, d2, d1
        else:
            cmd1, cmd2, f1, f2, desc1, desc2 = t1, t2, op1, op2, d1, d2

        # Генерируем случайную траекторию из 5 шагов, используя обе команды
        curr = start
        used1, used2 = False, False
        valid = True
        for _ in range(5):
            if random.choice([True, False]):
                nxt = f1(curr)
                if nxt is not None:
                    curr = nxt
                    used1 = True
                    continue
            nxt = f2(curr)
            if nxt is not None:
                curr = nxt
                used2 = True
            else:
                nxt1 = f1(curr)
                if nxt1 is not None:
                    curr = nxt1
                    used1 = True
                else:
                    valid = False
                    break

        if not valid or not (used1 and used2) or curr == start or curr > 300:
            continue

        sols = find_all_programs(start, curr, f1, f2, max_len=5)
        if len(sols) == 1 and len(sols[0]) == 5:
            prompt = (
                f"У исполнителя {exec_name} две команды, которым присвоены номера: 1. {cmd1};  2. {cmd2}.\n"
                f"Первая из них {desc1}, вторая — {desc2}.\n"
                f"Составьте алгоритм получения из числа {start} числа {curr}, содержащий не более 5 команд. В ответе запишите только номера команд."
            )
            return prompt, sols[0]

    return None

# =============================================================================
# ТОЧКА ВХОДА ГЕНЕРАТОРА
# =============================================================================

def generate():
    random.seed(os.urandom(16))

    for _ in range(50):
        archetype = random.choices(
            ["find_b_lin", "find_b_eq", "build_arith", "build_quad", "digit_ops"],
            weights=[0.30, 0.22, 0.18, 0.15, 0.15],
            k=1
        )[0]

        if archetype == "find_b_lin":
            res = generate_find_b_linear()
        elif archetype == "find_b_eq":
            res = generate_find_b_equation()
        elif archetype == "build_arith":
            res = generate_build_arithmetic()
        elif archetype == "build_quad":
            res = generate_build_quadrator()
        else:
            res = generate_digit_operations()

        if res is not None:
            prompt, answer = res
            return {
                "task": prompt,
                "variants": None,
                "answer": answer
            }

    # Гарантированный резервный вариант (fallback)
    return {
        "task": (
            "У исполнителя Альфа две команды, которым присвоены номера: 1. прибавь 1;  2. умножь на b (b — неизвестное натуральное число; b ≥ 2).\n"
            "Выполняя первую из них, Альфа увеличивает число на экране на 1, а выполняя вторую, умножает это число на b.\n"
            "Известно, что программа 11211 переводит число 6 в число 82. Определите значение b."
        ),
        "variants": None,
        "answer": "10"
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))