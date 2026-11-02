import sys
import json
import random
import os
import itertools

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

META = {
    "id": 7,
    "title": "Адресация в сети Интернет (IP-адреса, электронная почта, URL)",
    "has_variants": False
}

# =============================================================================
# СПРАВОЧНИКИ ДАННЫХ
# =============================================================================

PROTOCOLS = ["http", "https", "ftp"]

DOMAINS = [
    "school", "obr", "circ", "zoo", "game", "site", "pic", "jour",
    "sch", "book", "org", "home", "gov", "doc", "light", "travels",
    "classic", "rez", "magazin", "olympiada", "teach", "weather",
    "spring", "smile", "smtp", "color", "box", "presentation", "mypigs"
]

ZONES = ["ru", "com", "org", "net", "edu", "info", "kz", "рф"]

FILENAMES = [
    "slon", "tiger", "start", "doc", "img", "name", "spis", "math",
    "sotr", "hello", "boom", "home", "teach", "Mozart", "table",
    "kassa", "tests", "pas", "inf", "test", "rose", "pig", "winter",
    "may", "summer", "user"
]

EXTENSIONS = [
    "txt", "doc", "docx", "exe", "htm", "html", "bmp", "gif",
    "xml", "pdf", "jpg", "jpeg", "lib", "pas", "mp3", "xls",
    "rar", "cpp", "ppt"
]

DIRECTORIES = [
    "red", "work", "foto", "months", "docs", "archive", "files", "media", "tasks"
]

YEARS = ["2019", "2022", "2023", "2024", "2025"]

TRAP_URL_PRESETS = [
    ("txt", "net", "gov", "org", "http"),
    ("net", "txt", "doc", "com", "ftp"),
    ("edu", "lib", "net", "рф", "ftp"),
    ("com", "pas", "net", "ru", "http"),
    ("org", "docx", "rez", "ru", "http"),
    ("txt", "html", "ru", "net", "http"),
    ("pas", "cpp", "com", "edu", "ftp"),
    ("https", "txt", "smile", "ru", "https"),
    ("https", "ppt", "smtp", "org", "https"),
    ("ftp", "doc", "http", "org", "ftp"),
    ("htm", "rar", "xml", "net", "https")
]

# =============================================================================
# АРХЕТИП 1: ВОССТАНОВЛЕНИЕ IP-АДРЕСА ИЗ 4 ОБРЫВКОВ (25% — блок 1)
# =============================================================================

def fmt_ip_frag(s):
    """Форматирует обрывок IP-адреса крупно и с разрядкой, чтобы точки были чётко видны."""
    return f'<span style="letter-spacing: 1.4px; font-weight: 700; padding: 0 3px;">{s}</span>'

def is_valid_ipv4(s):
    """Проверяет, является ли строка s корректным IPv4-адресом."""
    parts = s.split(".")
    if len(parts) != 4:
        return False
    for p in parts:
        if not p or not p.isdigit():
            return False
        if len(p) > 1 and p.startswith("0"):
            return False
        if not (0 <= int(p) <= 255):
            return False
    return True

def generate_ip_fragments():
    letters = ["А", "Б", "В", "Г"]

    for _ in range(250):
        s1 = str(random.randint(120, 245))
        s2 = str(random.randint(120, 245))
        s3 = str(random.randint(120, 245))
        s4 = str(random.randint(15, 95))

        # Два канонических шаблона разреза ФИПИ (без висячих точек на конце и без 0.1):
        # Шаблон 1 (как в примерах 1, 3, 4, 5): "17" | "9.13" | "4.144" | ".44"
        # Шаблон 2 (как в примере 2):           "116.2" | "13" | ".23" | "4.243"
        if random.random() < 0.75:
            frags = [
                s1[:2],
                f"{s1[2:]}.{s2[:2]}",
                f"{s2[2:]}.{s3}",
                f".{s4}"
            ]
        else:
            s4_3dig = str(random.randint(120, 245))
            frags = [
                f"{s1}.{s2[:1]}",
                s2[1:],
                f".{s3[:2]}",
                f"{s3[2:]}.{s4_3dig}"
            ]

        if len(set(frags)) != 4:
            continue

        # Проверяем все 24 перестановки на строгую единственность валидного IPv4-адреса
        valid_perms = [
            perm for perm in itertools.permutations(range(4))
            if is_valid_ipv4("".join(frags[idx] for idx in perm))
        ]

        if len(valid_perms) == 1:
            shuffled = list(frags)
            random.shuffle(shuffled)

            ans_perm = [
                perm for perm in itertools.permutations(range(4))
                if is_valid_ipv4("".join(shuffled[idx] for idx in perm))
            ][0]
            answer = "".join(letters[idx] for idx in ans_perm)

            if random.choice([True, False]):
                story = (
                    "На месте преступления были обнаружены четыре обрывка бумаги. "
                    "Следствие установило, что на них записаны фрагменты одного IP-адреса. "
                    "Криминалисты обозначили эти фрагменты буквами А, Б, В и Г.\n"
                    "Восстановите IP-адрес. В ответе укажите последовательность букв, обозначающих фрагменты, "
                    "в порядке, соответствующем IP-адресу:"
                )
            else:
                boy = random.choice(["Миша", "Костя", "Дима", "Саша"])
                boy_gen = boy[:-1] + "ина"
                story = (
                    f"{boy} записал IP-адрес школьного сервера на листке бумаги и положил его в карман куртки. "
                    f"{boy_gen} мама случайно постирала куртку вместе с запиской. После стирки {boy} обнаружил в кармане "
                    "четыре обрывка с фрагментами IP-адреса, обозначенные буквами А, Б, В и Г.\n"
                    "Восстановите IP-адрес. В ответе укажите последовательность букв, обозначающих фрагменты, "
                    "в порядке, соответствующем IP-адресу:"
                )

            return {
                "task": story,
                "code_table": {
                    "headers": letters,
                    "rows": [[fmt_ip_frag(x) for x in shuffled]]
                },
                "variants": None,
                "answer": answer
            }
    return None

# =============================================================================
# АРХЕТИП 2: АДРЕС ЭЛЕКТРОННОЙ ПОЧТЫ (15% — блок 2)
# =============================================================================

EMAIL_PREFIX_1 = ["wait_", "write_", "send_", "best_", "info_", "read_", "open_", "check_"]
EMAIL_PREFIX_2 = ["for_", "to_", "your_", "my_", "new_", "all_", "our_", "top_"]
EMAIL_NOUNS = ["mail", "admin", "work", "club", "desk", "book", "task", "letter", "test"]
EMAIL_USERS = ["teacher", "director", "student", "support", "library", "olymp", "author", "master"]
EMAIL_SUBS = ["shkola1", "gymn5", "lyceum2", "portal", "center", "school9", "lit7", "club3"]
EMAIL_CITIES = ["mos", "spb", "obr", "edu", "city", "reg", "GorodN", "ufanet"]

def generate_email_address():
    use_letters = random.choice([True, False])
    labels = ["А", "Б", "В", "Г", "Д", "Е"] if use_letters else ["1", "2", "3", "4", "5", "6"]
    label_desc = "буквами от А до Е" if use_letters else "цифрами от 1 до 6"
    ans_desc = "букв" if use_letters else "цифр"

    for _ in range(100):
        zone = random.choice(["ru", "org", "net", "com", "edu"])
        if random.choice([True, False]):
            p1 = random.choice(EMAIL_PREFIX_1)
            p2 = random.choice(EMAIL_PREFIX_2)
            p3 = random.choice(EMAIL_NOUNS)
            dom = random.choice(EMAIL_CITIES + EMAIL_SUBS)
            box_name = f"{p1}{p2}{p3}"
            srv_name = f"{dom}.{zone}"
            target_seq = [p1, p2, p3, "@", dom, f".{zone}"]
        else:
            box_name = random.choice(EMAIL_USERS)
            sub = random.choice(EMAIL_SUBS)
            dom = random.choice(EMAIL_CITIES)
            srv_name = f"{sub}.{dom}.{zone}"
            target_seq = [box_name, "@", sub, ".", dom, f".{zone}"]

        if len(set(target_seq)) != 6:
            continue

        shuffled = list(target_seq)
        random.shuffle(shuffled)

        answer = "".join(labels[shuffled.index(tok)] for tok in target_seq)
        items_str = "   ".join(f"{labels[i]}) {shuffled[i]}" for i in range(6))

        if random.choice([True, False]):
            prompt = (
                f"На сервере {srv_name} находится почтовый ящик {box_name}. "
                f"Фрагменты адреса электронной почты закодированы {label_desc}. "
                f"Запишите последовательность {ans_desc}, кодирующую этот адрес:\n"
                f"{items_str}"
            )
        else:
            prompt = (
                f"Почтовый ящик {box_name} находится на сервере {srv_name}. "
                f"Фрагменты адреса электронной почты закодированы {label_desc}. "
                f"Запишите последовательность {ans_desc}, кодирующую этот адрес:\n"
                f"{items_str}"
            )

        return {
            "task": prompt,
            "variants": None,
            "answer": answer
        }
    return None

# =============================================================================
# АРХЕТИП 3: КЛАССИЧЕСКИЙ URL-АДРЕС ФАЙЛА ИЗ 7 ФРАГМЕНТОВ (40% — блок 3)
# =============================================================================

def generate_standard_url():
    use_letters = random.random() < 0.65
    labels = ["А", "Б", "В", "Г", "Д", "Е", "Ж"] if use_letters else ["1", "2", "3", "4", "5", "6", "7"]
    label_desc = "буквами от А до Ж" if use_letters else "цифрами от 1 до 7"
    ans_desc = "этих букв" if use_letters else "этих цифр"

    for _ in range(150):
        if random.random() < 0.35:
            fname, ext, dom, zone, proto = random.choice(TRAP_URL_PRESETS)
        else:
            proto = random.choice(PROTOCOLS)
            dom = random.choice(DOMAINS)
            zone = random.choice(ZONES)
            fname = random.choice(FILENAMES)
            ext = random.choice(EXTENSIONS)

        split_mode = random.choices(
            ["std", "dot_left_srv", "dot_left_file", "split_slashes"],
            weights=[0.55, 0.15, 0.15, 0.15],
            k=1
        )[0]

        if split_mode == "dot_left_srv":
            target_seq = [proto, "://", f"{dom}.", zone, "/", fname, f".{ext}"]
        elif split_mode == "dot_left_file":
            target_seq = [proto, "://", dom, f".{zone}", "/", f"{fname}.", ext]
        elif split_mode == "split_slashes":
            target_seq = [proto, ":/", f"/{dom}", f".{zone}", "/", fname, f".{ext}"]
        else:
            target_seq = [proto, "://", dom, f".{zone}", "/", fname, f".{ext}"]

        if len(set(target_seq)) != 7:
            continue

        shuffled = list(target_seq)
        random.shuffle(shuffled)

        answer = "".join(labels[shuffled.index(tok)] for tok in target_seq)
        items_str = "   ".join(f"{labels[i]}) {shuffled[i]}" for i in range(7))

        prompt = (
            f"Доступ к файлу {fname}.{ext}, находящемуся на сервере {dom}.{zone}, "
            f"осуществляется по протоколу {proto}. Фрагменты адреса файла закодированы {label_desc}. "
            f"Запишите последовательность {ans_desc}, кодирующую адрес указанного файла в сети Интернет:\n"
            f"{items_str}"
        )

        return {
            "task": prompt,
            "variants": None,
            "answer": answer
        }
    return None

# =============================================================================
# АРХЕТИП 4: ПЕРЕМЕЩЕНИЕ ФАЙЛА В СЕТИ ИНТЕРНЕТ (20% — примеры 28–31)
# =============================================================================

def generate_relocated_url():
    subtype = random.choices(
        ["to_other_site_dir", "to_other_site_root", "one_subdir", "two_subdirs"],
        weights=[0.30, 0.25, 0.25, 0.20],
        k=1
    )[0]

    for _ in range(150):
        old_proto, new_proto = random.sample(PROTOCOLS, 2)
        old_dom, new_dom = random.sample(DOMAINS, 2)
        old_zone = random.choice(ZONES)
        dir1 = random.choice(DIRECTORIES)
        dir2 = random.choice(YEARS)
        fname = random.choice(FILENAMES)
        ext = random.choice(EXTENSIONS)

        if len({old_dom, new_dom, dir1, fname, ext}) != 5:
            continue

        if subtype == "to_other_site_dir":
            new_zone = random.choice([z for z in ZONES if z != old_zone])
            old_url = f"{old_proto}://{old_dom}.{old_zone}/{fname}.{ext}"
            tokens = [
                f"{old_proto}:/", f"{new_proto}:/", "/",
                old_dom, new_dom, f".{new_zone}",
                dir1, fname, f".{ext}"
            ]
            target_seq = [f"{new_proto}:/", "/", new_dom, f".{new_zone}", "/", dir1, "/", fname, f".{ext}"]
            story = (
                f"Файл {fname}.{ext} был выложен в Интернете по адресу {old_url}. "
                f"Потом его переместили в каталог {dir1} на сайте {new_dom}.{new_zone}, "
                f"доступ к которому осуществляется по протоколу {new_proto}. Имя файла не изменилось."
            )

        elif subtype == "to_other_site_root":
            old_url = f"{old_proto}://{old_dom}.{old_zone}/{dir1}/{fname}.{ext}"
            tokens = [
                f"{old_proto}:/", f"{new_proto}:/", "/",
                old_dom, new_dom, f".{old_zone}",
                dir1, fname, f".{ext}"
            ]
            target_seq = [f"{new_proto}:/", "/", new_dom, f".{old_zone}", "/", fname, f".{ext}"]
            story = (
                f"Файл {fname}.{ext} был выложен в Интернете по адресу {old_url}. "
                f"Потом его переместили в корневой каталог на сайте {new_dom}.{old_zone}, "
                f"доступ к которому осуществляется по протоколу {new_proto}. Имя файла не изменилось."
            )

        elif subtype == "one_subdir":
            old_url = f"{old_proto}://{old_dom}.{old_zone}/{fname}.{ext}"
            tokens = [
                f"{old_proto}:/", "/", old_dom, f".{old_zone}",
                dir1, fname, f".{ext}"
            ]
            target_seq = [f"{old_proto}:/", "/", old_dom, f".{old_zone}", "/", dir1, "/", fname, f".{ext}"]
            story = (
                f"Файл {fname}.{ext} был выложен в Интернете по адресу {old_url}. "
                f"Потом на сайте создали подкаталог {dir1} и файл переместили в этот подкаталог."
            )

        else: # two_subdirs
            old_url = f"{old_proto}://{old_dom}.{old_zone}/{fname}.{ext}"
            tokens = [
                f"{new_proto}:/", f"{old_proto}:/", "/",
                old_dom, f".{old_zone}", dir1, dir2, fname, f".{ext}"
            ]
            target_seq = [f"{old_proto}:/", "/", old_dom, f".{old_zone}", "/", dir1, "/", dir2, "/", fname, f".{ext}"]
            story = (
                f"Файл {fname}.{ext} был выложен в Интернете по адресу {old_url}. "
                f"Потом на сайте создали подкаталог {dir1}, а в нём — подкаталог {dir2}, "
                f"и файл переместили в подкаталог {dir2}."
            )

        if len(set(tokens)) != len(tokens):
            continue

        shuffled = list(tokens)
        random.shuffle(shuffled)
        n_tok = len(shuffled)

        answer = "".join(str(shuffled.index(tok) + 1) for tok in target_seq)
        items_str = "   ".join(f"{i + 1}) {shuffled[i]}" for i in range(n_tok))

        prompt = (
            f"{story}\n"
            f"Фрагменты нового и старого адресов файла закодированы цифрами от 1 до {n_tok}. "
            "Запишите последовательность этих цифр, кодирующую адрес файла в сети Интернет после перемещения:\n"
            f"{items_str}"
        )

        return {
            "task": prompt,
            "variants": None,
            "answer": answer
        }
    return None

# =============================================================================
# ТОЧКА ВХОДА ГЕНЕРАТОРА
# =============================================================================

def generate():
    random.seed(os.urandom(16))

    for _ in range(50):
        archetype = random.choices(
            ["ip_frags", "email", "std_url", "reloc_url"],
            weights=[0.25, 0.15, 0.40, 0.20],
            k=1
        )[0]

        if archetype == "ip_frags":
            res = generate_ip_fragments()
        elif archetype == "email":
            res = generate_email_address()
        elif archetype == "std_url":
            res = generate_standard_url()
        else:
            res = generate_relocated_url()

        if res is not None:
            return res

    return {
        "task": (
            "Доступ к файлу slon.txt, находящемуся на сервере circ.org, осуществляется по протоколу http. "
            "Фрагменты адреса файла закодированы буквами от А до Ж. "
            "Запишите последовательность этих букв, кодирующую адрес указанного файла в сети Интернет:\n"
            "А) .txt   Б) ://   В) http   Г) circ   Д) /   Е) .org   Ж) slon"
        ),
        "variants": None,
        "answer": "ВБГЕДЖА"
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--meta":
            print(json.dumps(META, ensure_ascii=False))
        elif sys.argv[1] == "--generate":
            print(json.dumps(generate(), ensure_ascii=False))