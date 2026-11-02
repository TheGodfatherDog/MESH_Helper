import sys
import json
import random
import os
import math

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 9,
    "title": "Анализ схем дорог (подсчёт количества путей в графе)",
    "has_variants": False
}

# =============================================================================
# ПОСТРОЕНИЕ СЛУЧАЙНОГО ПЛАНАРНОГО ОРИЕНТИРОВАННОГО АЦИКЛИЧЕСКОГО ГРАФА (DAG)
# =============================================================================

def build_layered_dag(layer_sizes):
    """
    Генерирует случайный связный планарный ориентированный ациклический граф (DAG)
    по заданным размерам вертикальных слоёв. Центральные вершины в слоях из 3 точек
    имеют лёгкое шахматное смещение по оси X (как в банке ФИПИ / РешуОГЭ), чтобы
    вертикальные рёбра шли под аккуратным углом и не сливались в одну прямую.
    """
    num_layers = len(layer_sizes)
    if num_layers < 2:
        return None

    x_start, x_end = 26, 286
    step_x = (x_end - x_start) / (num_layers - 1)

    layers = []
    coords = []
    idx = 0

    for l_idx, sz in enumerate(layer_sizes):
        base_x = round(x_start + l_idx * step_x, 1)
        if sz == 1:
            pts = [(base_x, 60)]
        elif sz == 2:
            pts = [(base_x, 24), (base_x, 96)]
        else:  # sz == 3: лёгкое смещение средней точки для наглядности углов
            mid_shift = -10 if (l_idx % 2 == 1) else 10
            pts = [(base_x, 16), (round(base_x + mid_shift, 1), 60), (base_x, 104)]

        layer_nodes = []
        for pt in pts:
            coords.append(pt)
            layer_nodes.append(idx)
            idx += 1
        layers.append(layer_nodes)

    n = idx
    edges_set = set()

    # 1. Межслойные рёбра между соседними слоями L и L+1 (строго планарные)
    for l_idx in range(num_layers - 1):
        curr_l = layers[l_idx]
        next_l = layers[l_idx + 1]
        s1, s2 = len(curr_l), len(next_l)

        if s1 == 1 and s2 == 3:
            for v in next_l:
                edges_set.add((curr_l[0], v))
        elif s1 == 1 and s2 == 2:
            for v in next_l:
                edges_set.add((curr_l[0], v))
        elif s1 == 3 and s2 == 1:
            for u in curr_l:
                edges_set.add((u, next_l[0]))
        elif s1 == 2 and s2 == 1:
            for u in curr_l:
                edges_set.add((u, next_l[0]))
        elif s1 == 3 and s2 == 3:
            skip_h = random.choice([-1, -1, 0, 1, 2])
            for i in range(3):
                if i != skip_h:
                    edges_set.add((curr_l[i], next_l[i]))
            up_diag = random.choice(["none", "down", "up"])
            if up_diag == "down":
                edges_set.add((curr_l[0], next_l[1]))
            elif up_diag == "up":
                edges_set.add((curr_l[1], next_l[0]))
            low_diag = random.choice(["none", "down", "up"])
            if low_diag == "down":
                edges_set.add((curr_l[1], next_l[2]))
            elif low_diag == "up":
                edges_set.add((curr_l[2], next_l[1]))
        elif s1 == 3 and s2 == 2:
            edges_set.add((curr_l[0], next_l[0]))
            edges_set.add((curr_l[2], next_l[1]))
            mid_choice = random.choice(["both", "top", "bot"])
            if mid_choice in ("both", "top"):
                edges_set.add((curr_l[1], next_l[0]))
            if mid_choice in ("both", "bot"):
                edges_set.add((curr_l[1], next_l[1]))
        elif s1 == 2 and s2 == 3:
            edges_set.add((curr_l[0], next_l[0]))
            edges_set.add((curr_l[1], next_l[2]))
            mid_choice = random.choice(["both", "top", "bot"])
            if mid_choice in ("both", "top"):
                edges_set.add((curr_l[0], next_l[1]))
            if mid_choice in ("both", "bot"):
                edges_set.add((curr_l[1], next_l[1]))
        elif s1 == 2 and s2 == 2:
            edges_set.add((curr_l[0], next_l[0]))
            edges_set.add((curr_l[1], next_l[1]))
            diag = random.choice(["down", "up", "none"])
            if diag == "down":
                edges_set.add((curr_l[0], next_l[1]))
            elif diag == "up":
                edges_set.add((curr_l[1], next_l[0]))

    # 2. Внутрислойные вертикальные/наклонные рёбра (вверх или вниз, без циклов)
    for l_idx in range(1, num_layers - 1):
        curr_l = layers[l_idx]
        if len(curr_l) == 2:
            v_mode = random.choice(["down", "up", "none"])
            if v_mode == "down":
                edges_set.add((curr_l[0], curr_l[1]))
            elif v_mode == "up":
                edges_set.add((curr_l[1], curr_l[0]))
        elif len(curr_l) == 3:
            top_mode = random.choice(["down", "up", "none"])
            bot_mode = random.choice(["down", "up", "none"])
            if top_mode == "down":
                edges_set.add((curr_l[0], curr_l[1]))
            elif top_mode == "up":
                edges_set.add((curr_l[1], curr_l[0]))
            if bot_mode == "down":
                edges_set.add((curr_l[1], curr_l[2]))
            elif bot_mode == "up":
                edges_set.add((curr_l[2], curr_l[1]))

    edges = sorted(edges_set)

    in_deg = [0] * n
    out_deg = [0] * n
    for u, v in edges:
        out_deg[u] += 1
        in_deg[v] += 1

    if any(in_deg[i] == 0 for i in range(1, n)) or any(out_deg[i] == 0 for i in range(0, n - 1)):
        return None

    return coords, edges, layers

# =============================================================================
# ТОЧНЫЙ ПОДСЧЁТ ПУТЕЙ В DAG (МЕМОИЗИРОВАННЫЙ DFS)
# =============================================================================

def count_dag_paths(n, edges, must_node=None, avoid_node=None):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        if u != avoid_node and v != avoid_node:
            adj[u].append(v)

    def ways_between(src, dst):
        if src == avoid_node or dst == avoid_node:
            return 0
        memo = {}

        def dfs(curr):
            if curr == dst:
                return 1
            if curr in memo:
                return memo[curr]
            total = 0
            for nxt in adj[curr]:
                total += dfs(nxt)
            memo[curr] = total
            return total

        return dfs(src)

    if must_node is not None:
        return ways_between(0, must_node) * ways_between(must_node, n - 1)
    return ways_between(0, n - 1)

# =============================================================================
# ВЫЧИСЛЕНИЕ СВОБОДНОГО СЕКТОРА ДЛЯ ПОДПИСИ БУКВЫ ВЕРШИНЫ И РЕНДЕР SVG
# =============================================================================

def find_best_label_pos(i, n, coords, edges):
    """
    Находит направление с самым широким свободным углом между инцидентными
    рёбрами вершины i, чтобы буква никогда не пересекалась со стрелками.
    """
    x, y = coords[i]
    if i == 0:
        return x - 11, y + 4
    if i == n - 1:
        return x + 11, y + 4
    if y <= 20:
        return x, y - 9
    if y >= 98:
        return x, y + 14

    # Для внутренних вершин среднего ряда ищем самый широкий свободный угловой сектор
    angles = []
    for u, v in edges:
        if u == i:
            nx, ny = coords[v]
            angles.append(math.atan2(ny - y, nx - x))
        elif v == i:
            nx, ny = coords[u]
            angles.append(math.atan2(ny - y, nx - x))

    if not angles:
        return x, y - 10

    angles.sort()
    best_gap = -1.0
    best_ang = -math.pi / 2

    for k in range(len(angles)):
        a1 = angles[k]
        a2 = angles[(k + 1) % len(angles)]
        gap = (a2 - a1) if k + 1 < len(angles) else (a2 + 2 * math.pi - a1)
        if gap > best_gap:
            best_gap = gap
            best_ang = a1 + gap / 2.0

    dist = 12.5
    lx = x + dist * math.cos(best_ang)
    ly = y + dist * math.sin(best_ang) + 4.0
    return lx, ly

def render_dag_svg(coords, edges, labels):
    n = min(len(coords), len(labels))
    parts = [
        '<svg width="314" height="120" viewBox="0 0 314 120" '
        'xmlns="http://www.w3.org/2000/svg" style="display:block;margin:2px 0;overflow:visible;">'
    ]

    r_dot = 3.2
    arrow_len = 7.8
    arrow_ang = 0.40

    for u, v in edges:
        if u >= n or v >= n:
            continue
        x1, y1 = coords[u]
        x2, y2 = coords[v]
        dx, dy = x2 - x1, y2 - y1
        dist = math.hypot(dx, dy)
        if dist < 1e-3:
            continue

        ux, uy = dx / dist, dy / dist
        sx, sy = x1 + ux * r_dot, y1 + uy * r_dot
        tx, ty = x2 - ux * (r_dot + 0.8), y2 - uy * (r_dot + 0.8)
        lx, ly = tx - ux * 3.8, ty - uy * 3.8

        parts.append(
            f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{lx:.1f}" y2="{ly:.1f}" '
            'stroke="#1e293b" stroke-width="1.4" />'
        )

        ang = math.atan2(dy, dx)
        wx1 = tx - arrow_len * math.cos(ang - arrow_ang)
        wy1 = ty - arrow_len * math.sin(ang - arrow_ang)
        wx2 = tx - arrow_len * math.cos(ang + arrow_ang)
        wy2 = ty - arrow_len * math.sin(ang + arrow_ang)
        bx = tx - (arrow_len * 0.72) * ux
        by = ty - (arrow_len * 0.72) * uy

        parts.append(
            f'<polygon points="{tx:.1f},{ty:.1f} {wx1:.1f},{wy1:.1f} {bx:.1f},{by:.1f} {wx2:.1f},{wy2:.1f}" '
            'fill="#1e293b" />'
        )

    for i in range(n):
        x, y = coords[i]
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r_dot}" fill="#b45309" />')

        tx, ty = find_best_label_pos(i, n, coords, edges)
        parts.append(
            f'<text x="{tx:.1f}" y="{ty:.1f}" text-anchor="middle" '
            'font-family="Arial, sans-serif" font-size="11.5" font-weight="bold" fill="#0f172a" '
            'style="paint-order:stroke;stroke:#ffffff;stroke-width:3.5px;stroke-linejoin:round;">'
            f'{labels[i]}</text>'
        )

    parts.append('</svg>')
    return "".join(parts)

# =============================================================================
# АРХЕТИП 1: ВСЕ ПУТИ ИЗ НАЧАЛЬНОГО ПУНКТА В КОНЕЧНЫЙ (45% — блок 1)
# =============================================================================

def generate_all_paths():
    templates = [
        ([1, 2, 2, 1], ["A", "B", "C", "D", "E", "F"]),
        ([1, 3, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "К"]),
        ([1, 3, 2, 1], ["A", "B", "C", "D", "E", "F", "G"]),
        ([1, 3, 3, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "К"]),
        ([1, 3, 3, 1], ["A", "B", "C", "D", "E", "F", "G", "H"]),
        ([1, 3, 2, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И"]),
        ([1, 3, 3, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К"]),
        ([1, 3, 3, 3, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л"])
    ]

    for _ in range(150):
        layer_sizes, base_labels = random.choice(templates)
        dag = build_layered_dag(layer_sizes)
        if dag is None:
            continue

        coords, edges, _ = dag
        n = len(coords)
        ans = count_dag_paths(n, edges)

        if not (6 <= ans <= 38):
            continue

        labels = list(base_labels)
        if labels[0] == "A" and n in (7, 8) and random.random() < 0.25:
            target_letter = random.choice(["D", "F"])
            idx_t = labels.index(target_letter)
            labels[idx_t], labels[-1] = labels[-1], labels[idx_t]

        start_lbl, end_lbl = labels[0], labels[-1]
        cities_str = ", ".join(labels[:-1]) + f" и {labels[-1]}"
        svg_html = render_dag_svg(coords, edges, labels)

        prompt = (
            f"На рисунке — схема дорог, связывающих города {cities_str}. "
            "По каждой дороге можно двигаться только в одном направлении, указанном стрелкой.\n"
            f"{svg_html}\n"
            f"Сколько существует различных путей из города {start_lbl} в город {end_lbl}?"
        )
        return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 2: ПУТИ, ПРОХОДЯЩИЕ ЧЕРЕЗ ПРОМЕЖУТОЧНЫЙ ГОРОД X (28% — блок 2)
# =============================================================================

def generate_must_pass():
    templates = [
        ([1, 3, 3, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "К"]),
        ([1, 3, 2, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И"]),
        ([1, 3, 2, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "И", "К"]),
        ([1, 3, 3, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "И", "К", "Л"]),
        ([1, 3, 3, 3, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л"]),
        ([1, 3, 3, 2, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "К", "Л", "М", "Н", "П"])
    ]

    for _ in range(150):
        layer_sizes, labels = random.choice(templates)
        dag = build_layered_dag(layer_sizes)
        if dag is None:
            continue

        coords, edges, _ = dag
        n = len(coords)
        total = count_dag_paths(n, edges)

        candidates = list(range(1, n - 1))
        random.shuffle(candidates)

        for mid in candidates:
            ans = count_dag_paths(n, edges, must_node=mid)
            if 6 <= ans <= 42 and ans < total - 1:
                cities_str = ", ".join(labels[:-1]) + f" и {labels[-1]}"
                svg_html = render_dag_svg(coords, edges, labels)
                prompt = (
                    f"На рисунке — схема дорог, связывающих города {cities_str}. "
                    "По каждой дороге можно двигаться только в одном направлении, указанном стрелкой.\n"
                    f"{svg_html}\n"
                    f"Сколько существует различных путей из города {labels[0]} в город {labels[-1]}, "
                    f"проходящих через город {labels[mid]}?"
                )
                return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 3: ПУТИ, НЕ ПРОХОДЯЩИЕ ЧЕРЕЗ ГОРОД Y (17% — примеры 7–9, 16–17)
# =============================================================================

def generate_avoid_node():
    templates = [
        ([1, 3, 2, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "И", "К"]),
        ([1, 3, 3, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "И", "К", "Л"]),
        ([1, 3, 3, 3, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л"])
    ]

    for _ in range(150):
        layer_sizes, labels = random.choice(templates)
        dag = build_layered_dag(layer_sizes)
        if dag is None:
            continue

        coords, edges, _ = dag
        n = len(coords)
        total = count_dag_paths(n, edges)

        candidates = list(range(1, n - 1))
        random.shuffle(candidates)

        for avoid in candidates:
            ans = count_dag_paths(n, edges, avoid_node=avoid)
            if 4 <= ans <= 32 and ans < total - 2:
                cities_str = ", ".join(labels[:-1]) + f" и {labels[-1]}"
                svg_html = render_dag_svg(coords, edges, labels)
                prompt = (
                    f"На рисунке — схема дорог, связывающих города {cities_str}. "
                    "По каждой дороге можно двигаться только в одном направлении, указанном стрелкой.\n"
                    f"{svg_html}\n"
                    f"Сколько существует различных путей из пункта {labels[0]} в пункт {labels[-1]}, "
                    f"не проходящих через пункт {labels[avoid]}?"
                )
                return prompt, str(ans)

    return None

# =============================================================================
# АРХЕТИП 4: ПРОХОДЯЩИЕ ЧЕРЕЗ X, НО НЕ ПРОХОДЯЩИЕ ЧЕРЕЗ Y (10% — пример 18)
# =============================================================================

def generate_must_and_avoid():
    templates = [
        ([1, 3, 3, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К"]),
        ([1, 3, 3, 3, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л"]),
        ([1, 3, 3, 2, 2, 1], ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л", "М"])
    ]

    for _ in range(200):
        layer_sizes, labels = random.choice(templates)
        dag = build_layered_dag(layer_sizes)
        if dag is None:
            continue

        coords, edges, layers = dag
        n = len(coords)
        total = count_dag_paths(n, edges)

        early_nodes = list(layers[1])
        late_nodes = list(layers[2] + layers[3])

        random.shuffle(early_nodes)
        random.shuffle(late_nodes)

        for must in early_nodes:
            via_must_only = count_dag_paths(n, edges, must_node=must)
            if via_must_only >= total or via_must_only < 6:
                continue
            for avoid in late_nodes:
                if avoid == must:
                    continue
                ans = count_dag_paths(n, edges, must_node=must, avoid_node=avoid)
                if 4 <= ans < via_must_only - 1:
                    cities_str = ", ".join(labels[:-1]) + f" и {labels[-1]}"
                    svg_html = render_dag_svg(coords, edges, labels)
                    prompt = (
                        f"На рисунке представлена схема дорог, связывающих города {cities_str}. "
                        "По каждой дороге можно двигаться только в одном направлении, указанном стрелкой.\n"
                        f"{svg_html}\n"
                        f"Сколько существует различных путей из города {labels[0]} в город {labels[-1]}, "
                        f"проходящих через город {labels[must]}, но не проходящих через город {labels[avoid]}?"
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
            ["all_paths", "must_pass", "avoid_node", "must_and_avoid"],
            weights=[0.45, 0.28, 0.17, 0.10],
            k=1
        )[0]

        if archetype == "all_paths":
            res = generate_all_paths()
        elif archetype == "must_pass":
            res = generate_must_pass()
        elif archetype == "avoid_node":
            res = generate_avoid_node()
        else:
            res = generate_must_and_avoid()

        if res is not None:
            prompt, answer = res
            return {
                "task": prompt,
                "variants": None,
                "answer": answer
            }

    # Рандомизированный резервный вариант (fallback)
    fb_coords = [(26, 60), (96, 16), (144, 60), (96, 104), (176, 16), (194, 104), (236, 16), (286, 60)]
    fb_edges = [(0, 1), (0, 2), (0, 3), (1, 4), (2, 4), (2, 5), (3, 5), (4, 6), (5, 6), (5, 7), (6, 7)]
    if random.choice([True, False]):
        fb_edges.append((4, 5))
    fb_labels = (
        ["A", "B", "C", "D", "E", "F", "G", "H"]
        if random.choice([True, False])
        else ["А", "Б", "В", "Г", "Д", "Е", "Ж", "К"]
    )
    fb_ans = count_dag_paths(len(fb_coords), fb_edges)
    fb_svg = render_dag_svg(fb_coords, fb_edges, fb_labels)
    cities_str = ", ".join(fb_labels[:-1]) + f" и {fb_labels[-1]}"
    return {
        "task": (
            f"На рисунке — схема дорог, связывающих города {cities_str}. "
            "По каждой дороге можно двигаться только в одном направлении, указанном стрелкой.\n"
            f"{fb_svg}\n"
            f"Сколько существует различных путей из города {fb_labels[0]} в город {fb_labels[-1]}?"
        ),
        "variants": None,
        "answer": str(fb_ans)
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))