import sys
import json
import random
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 4,
    "title": "Кратчайший путь в графе по таблице протяжённости дорог",
    "has_variants": False
}

# =============================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОИСКА ПРОСТЫХ ПУТЕЙ И СБОРКИ ТАБЛИЦЫ
# =============================================================================

# Непустой HTML-тег: визуально рисует пустую клетку, но для vpr.js не считается
# пустой ячейкой бланка ответов (isAnsTbl = false), сохраняя строку «Ответ: ___»
EMPTY_CELL = "<span></span>"

def find_all_simple_paths(adj, start, end):
    """
    Находит ВСЕ простые пути (без повторного посещения вершин) от start до end.
    Возвращает список кортежей: (суммарная_длина, список_вершин, список_весов_рёбер),
    отсортированный по возрастанию суммарной длины.
    """
    n = len(adj)
    results = []

    def dfs(curr, visited_mask, path_nodes, path_edges, total_w):
        if curr == end:
            results.append((total_w, list(path_nodes), list(path_edges)))
            return
        for nxt in range(n):
            w = adj[curr][nxt]
            if w > 0 and not (visited_mask & (1 << nxt)):
                path_nodes.append(nxt)
                path_edges.append(w)
                dfs(nxt, visited_mask | (1 << nxt), path_nodes, path_edges, total_w + w)
                path_nodes.pop()
                path_edges.pop()

    dfs(start, 1 << start, [start], [], 0)
    results.sort(key=lambda item: item[0])
    return results

def build_matrix_table(labels, adj):
    """Формирует симметричную таблицу смежности для рендерера vpr.js."""
    n = len(labels)
    headers = [EMPTY_CELL] + [str(lbl) for lbl in labels]
    rows = []
    for i in range(n):
        row = [f"<b>{labels[i]}</b>"]
        for j in range(n):
            if adj[i][j] > 0:
                row.append(str(adj[i][j]))
            else:
                row.append(EMPTY_CELL)
        rows.append(row)
    return {"headers": headers, "rows": rows}

def generate_graph_with_trap(n, start, end, min_steps=3):
    """
    Строит связный неориентированный граф на n вершинах с гарантированным
    обходным кратчайшим путём длины >= min_steps рёбер и «дорогами-ловушками»
    (прямой дорогой или путём в 2 шага, которые длиннее оптимального).
    """
    other_nodes = [v for v in range(n) if v not in (start, end)]
    random.shuffle(other_nodes)

    # Количество промежуточных вершин на главном кратчайшем пути (2..4)
    inter_count = min(len(other_nodes), random.randint(min_steps - 1, min(4, len(other_nodes))))
    backbone = [start] + other_nodes[:inter_count] + [end]

    adj = [[0] * n for _ in range(n)]
    opt_weights = [random.randint(1, 4) for _ in range(len(backbone) - 1)]
    opt_total = sum(opt_weights)

    for i in range(len(backbone) - 1):
        u, v = backbone[i], backbone[i + 1]
        w = opt_weights[i]
        adj[u][v] = adj[v][u] = w

    # Подключаем оставшиеся вершины, если они не вошли в главный маршрут
    unused = other_nodes[inter_count:]
    for u in unused:
        v1, v2 = random.sample(backbone, 2)
        w1 = random.randint(2, 6)
        w2 = random.randint(3, 8)
        adj[u][v1] = adj[v1][u] = w1
        adj[u][v2] = adj[v2][u] = w2

    # Добавляем прямую дорогу-ловушку между start и end (с вероятностью 65%)
    if random.random() < 0.65:
        direct_w = opt_total + random.randint(2, 8)
        adj[start][end] = adj[end][start] = direct_w

    # Добавляем 2–4 дополнительные хорды-ловушки для разветвлённости
    for _ in range(random.randint(2, 4)):
        u, v = random.sample(range(n), 2)
        if adj[u][v] == 0:
            adj[u][v] = adj[v][u] = random.randint(3, 9)

    return adj

# =============================================================================
# АРХЕТИП 1: КЛАССИЧЕСКИЙ КРАТЧАЙШИЙ ПУТЬ МЕЖДУ ДВУМЯ ПУНКТАМИ (48%)
# =============================================================================

def generate_standard_shortest():
    n = random.choices([4, 5, 6], weights=[0.12, 0.53, 0.35], k=1)[0]
    labels = ["A", "B", "C", "D", "E", "F"][:n]

    for _ in range(150):
        # В 55% случаев ищем путь от A до последнего пункта, в 45% — между произвольной парой
        if random.random() < 0.55:
            s_idx, e_idx = 0, n - 1
        else:
            s_idx, e_idx = sorted(random.sample(range(n), 2))

        min_edges = 2 if n == 4 else 3
        adj = generate_graph_with_trap(n, s_idx, e_idx, min_steps=min_edges)
        paths = find_all_simple_paths(adj, s_idx, e_idx)

        if len(paths) < 3:
            continue

        best_w, best_nodes, _ = paths[0]
        # Проверяем, что кратчайший путь нетривиален и содержит минимум min_edges переходов
        if len(best_nodes) - 1 < min_edges:
            continue
        if best_w < 4:
            continue

        s_lbl, e_lbl = labels[s_idx], labels[e_idx]
        points_str = ", ".join(labels)

        tail_variants = [
            "Передвигаться можно только по дорогам, протяжённость которых указана в таблице.",
            "Передвигаться можно только по построенным дорогам."
        ]

        prompt = (
            f"Между населёнными пунктами {points_str} построены дороги, протяжённость которых (в километрах) приведена в таблице.\n"
            f"Определите длину кратчайшего пути между пунктами {s_lbl} и {e_lbl}. {random.choice(tail_variants)}\n"
            "Таблица протяжённости дорог:"
        )

        return {
            "task": prompt,
            "table": build_matrix_table(labels, adj),
            "variants": None,
            "answer": str(best_w)
        }
    return None

# =============================================================================
# АРХЕТИП 2: КРАТЧАЙШИЙ ПУТЬ ЧЕРЕЗ ОБЯЗАТЕЛЬНЫЙ ПУНКТ Z (32%)
# =============================================================================

def generate_via_intermediate():
    n = random.choices([5, 6], weights=[0.60, 0.40], k=1)[0]
    labels = ["A", "B", "C", "D", "E", "F"][:n]

    for _ in range(200):
        if random.random() < 0.65:
            s_idx, e_idx = 0, n - 1
        else:
            s_idx, e_idx = sorted(random.sample(range(n), 2))

        mid_candidates = [i for i in range(n) if i not in (s_idx, e_idx)]
        mid_idx = random.choice(mid_candidates)

        adj = generate_graph_with_trap(n, s_idx, e_idx, min_steps=3)

        all_paths = find_all_simple_paths(adj, s_idx, e_idx)
        via_paths = [p for p in all_paths if mid_idx in p[1]]

        if not all_paths or len(via_paths) < 2:
            continue

        global_best_w = all_paths[0][0]
        via_best_w, via_best_nodes, _ = via_paths[0]

        # Гарантируем, что условие «проходящего через пункт Z» существенно:
        # глобальный кратчайший путь строго короче пути через Z, а путь через Z имеет >= 3 рёбер
        if via_best_w <= global_best_w:
            continue
        if len(via_best_nodes) - 1 < 3 or via_best_w < 5:
            continue

        s_lbl, e_lbl, m_lbl = labels[s_idx], labels[e_idx], labels[mid_idx]
        points_str = ", ".join(labels)

        prompt = (
            f"Между населёнными пунктами {points_str} построены дороги, протяжённость которых (в километрах) приведена в таблице.\n"
            f"Определите длину кратчайшего пути между пунктами {s_lbl} и {e_lbl}, проходящего через пункт {m_lbl}. "
            "Передвигаться можно только по дорогам, протяжённость которых указана в таблице. Каждый пункт можно посетить только один раз.\n"
            "Таблица протяжённости дорог:"
        )

        return {
            "task": prompt,
            "table": build_matrix_table(labels, adj),
            "variants": None,
            "answer": str(via_best_w)
        }
    return None

# =============================================================================
# АРХЕТИП 3: СЮЖЕТНЫЕ ЗАДАЧИ С НАЗВАНИЯМИ НАСЕЛЁННЫХ ПУНКТОВ (12%)
# =============================================================================

VILLAGE_NAMES_POOL = [
    "Антоновка", "Борки", "Васильки", "Вершки", "Дальнее",
    "Дружба", "Дубово", "Ежевичная", "Заречье", "Ивановское",
    "Красное", "Лесное", "Луговое", "Озёрное", "Сельская", "Сосновка"
]

def generate_story_villages():
    n = random.choice([5, 6])
    chosen_names = random.sample(VILLAGE_NAMES_POOL, n)

    for _ in range(150):
        s_idx, e_idx = 0, random.randint(2, n - 1)
        adj = generate_graph_with_trap(n, s_idx, e_idx, min_steps=3)
        paths = find_all_simple_paths(adj, s_idx, e_idx)

        if len(paths) < 3:
            continue

        best_w, best_nodes, _ = paths[0]
        if len(best_nodes) - 1 < 3 or best_w < 4:
            continue

        s_name, e_name = chosen_names[s_idx], chosen_names[e_idx]

        stories = [
            (
                f"Учитель Иван Петрович живёт на станции {s_name}, а работает на станции {e_name}. "
                "Чтобы успеть с утра на уроки, он должен ехать по самой короткой дороге.\n"
                f"Проанализируйте таблицу и укажите длину кратчайшего пути от станции {s_name} до станции {e_name}:\n"
                "Таблица дорог:"
            ),
            (
                f"Сельская малокомплектная школа находится в посёлке {e_name}. Коля Иванов живёт в деревне {s_name}.\n"
                f"Определите, какое минимальное расстояние ему надо пройти по построенным дорогам, чтобы добраться из деревни {s_name} до школы в посёлке {e_name}:\n"
                "Таблица дорог:"
            ),
            (
                f"Велосипедист выехал из посёлка {s_name} и направляется в посёлок {e_name}. "
                "В таблице указана протяжённость дорог (в километрах) между соседними населёнными пунктами.\n"
                f"Определите длину кратчайшего маршрута из посёлка {s_name} в посёлок {e_name}:\n"
                "Таблица дорог:"
            )
        ]

        return {
            "task": random.choice(stories),
            "table": build_matrix_table(chosen_names, adj),
            "variants": None,
            "answer": str(best_w)
        }
    return None

# =============================================================================
# АРХЕТИП 4: САМЫЙ ДЛИННЫЙ УЧАСТОК КРАТЧАЙШЕГО ПУТИ (8% — пример 13)
# =============================================================================

def generate_longest_segment():
    labels = ["А", "Б", "В", "Г", "И", "М"]
    n = len(labels)
    s_idx, e_idx = 4, 5  # от И до М

    for _ in range(200):
        adj = generate_graph_with_trap(n, s_idx, e_idx, min_steps=3)
        paths = find_all_simple_paths(adj, s_idx, e_idx)

        if len(paths) < 3:
            continue

        best_w, best_nodes, best_edges = paths[0]
        second_w = paths[1][0]

        # Кратчайший путь должен быть СТРОГО единственным и состоять минимум из 3 участков
        if best_w == second_w or len(best_edges) < 3:
            continue

        # Участки на кратчайшем пути должны различаться по длине
        if len(set(best_edges)) < 2:
            continue

        max_edge = max(best_edges)
        prompt = (
            "Иван-Царевич спешит выручить Марью-Царевну из плена Кощея. В таблице указана протяжённость дорог между пунктами, через которые он может пройти.\n"
            "Укажите длину самого длинного участка кратчайшего пути от Ивана-Царевича до Марьи-Царевны (от точки И до точки М). Передвигаться можно только по дорогам, указанным в таблице:\n"
            "Таблица протяжённости дорог:"
        )

        return {
            "task": prompt,
            "table": build_matrix_table(labels, adj),
            "variants": None,
            "answer": str(max_edge)
        }
    return None

# =============================================================================
# ТОЧКА ВХОДА ГЕНЕРАТОРА
# =============================================================================

def generate():
    random.seed(os.urandom(16))

    for _ in range(50):
        archetype = random.choices(
            ["standard", "via_mid", "villages", "longest_seg"],
            weights=[0.48, 0.32, 0.12, 0.08],
            k=1
        )[0]

        if archetype == "standard":
            res = generate_standard_shortest()
        elif archetype == "via_mid":
            res = generate_via_intermediate()
        elif archetype == "villages":
            res = generate_story_villages()
        else:
            res = generate_longest_segment()

        if res is not None:
            return res

    # Гарантированный детерминированный резервный вариант (fallback)
    fallback_labels = ["A", "B", "C", "D", "E"]
    fallback_adj = [
        [0, 2, 5, 1, 0],
        [2, 0, 3, 0, 0],
        [5, 3, 0, 3, 2],
        [1, 0, 3, 0, 0],
        [0, 0, 2, 0, 0]
    ]
    return {
        "task": (
            "Между населёнными пунктами A, B, C, D, E построены дороги, протяжённость которых (в километрах) приведена в таблице.\n"
            "Определите длину кратчайшего пути между пунктами A и E. Передвигаться можно только по дорогам, протяжённость которых указана в таблице.\n"
            "Таблица протяжённости дорог:"
        ),
        "table": build_matrix_table(fallback_labels, fallback_adj),
        "variants": None,
        "answer": "6"
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))