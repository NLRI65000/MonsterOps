# MonsterOps — Active Directory Authentication

How to let subscribers or staff sign in through Active Directory, and when you
need the extra server-side setup that can't be done from the web UI.

---

## Table of Contents

1. [Two ways to use AD — pick one](#1-two-ways-to-use-ad--pick-one)
2. [Do you actually need the domain join?](#2-do-you-actually-need-the-domain-join)
3. [Prerequisites](#3-prerequisites)
4. [Step 1 — Create the identity source and realm](#4-step-1--create-the-identity-source-and-realm)
5. [Step 2 — Join the host to the domain (`provision-ad.sh`)](#5-step-2--join-the-host-to-the-domain-provision-adsh)
6. [Step 3 — Verify](#6-step-3--verify)
7. [Step 4 — Map groups and import users](#7-step-4--map-groups-and-import-users)
8. [Troubleshooting](#8-troubleshooting)
9. [Removing delegated auth / leaving the domain](#9-removing-delegated-auth--leaving-the-domain)
10. [Reference — what the script changes](#10-reference--what-the-script-changes)

---

## 1. Two ways to use AD — pick one

MonsterOps can use Active Directory in two different ways. They are set per realm,
on the **Realms & Proxy → Authentication** tab, via the realm's **authentication
method**.

| | **Local password** | **Directory-delegated** |
|---|---|---|
| Who checks the password | MonsterOps (from its own DB) | The Domain Controller, live, at each login |
| Where the password lives | In MonsterOps (`radcheck`) | Only in AD — never copied out |
| AD's role | Source of the **user list** (optional sync) | Source of the **user list _and_ the password check** |
| NAS protocols | PAP, CHAP, MS-CHAPv2, EAP | MS-CHAPv2, PAP |
| Works if the DC is offline | **Yes** | No — needs a reachable DC |
| Extra server setup | None | **Domain join** (this guide) |

**Local password** is the default and needs nothing beyond the web UI. You point a
realm at AD, import the users you want, and MonsterOps sets/holds each subscriber's
password. The trade-off: subscribers don't log in with their *live* AD password —
they use the password MonsterOps holds.

**Directory-delegated** lets people log in with their **real AD password**. Nothing
is exported from AD; FreeRADIUS asks a Domain Controller to verify each login through
winbind / `ntlm_auth`. That requires this host to be **joined to the domain**, which
is a one-time, root-level, server-side step — the rest of this guide.

> Why can't the domain join be a button in the UI? It installs system packages,
> rewrites host config (`/etc/krb5.conf`, `/etc/samba/smb.conf`), and runs
> `net ads join`, which **creates a machine account in your live Active Directory**
> using domain-admin credentials. That is host administration, not application
> configuration — the MonsterOps app runs as an unprivileged user and deliberately
> cannot do it.

---

## 2. Do you actually need the domain join?

Only if you want **real-AD-password login** (directory-delegated). If either of the
following is true, stay on **Local password** and skip Steps 2–3 entirely:

- You just want AD to be the **source of the user list** (create/disable users, map
  groups to plans) — sync does this on a local-password realm with no domain join.
- You don't want a **runtime dependency** on the Domain Controller being reachable.

You can change a realm's method later (**Authentication → Edit**), so it's fine to
start local and move to delegated once the host is joined.

---

## 3. Prerequisites

Before running the join, on the RADIUS host:

- **Root access** (`sudo`) on the MonsterOps/FreeRADIUS host.
- **MonsterOps already installed** (`deploy/install.sh` has run; the `monsterops`
  service user and FreeRADIUS exist).
- **DNS** that resolves the AD domain and its DCs. The host should use the AD DNS
  servers (or one that can resolve the `_ldap._tcp.<domain>` SRV records).
- **Time sync** with the domain (Kerberos rejects clocks more than ~5 min off — run
  `chronyd`/`systemd-timesyncd`, ideally against the DC).
- **Domain-admin (or delegated join) credentials** — used once, interactively, to
  create the machine account. MonsterOps never stores them.
- The AD **DNS realm** (e.g. `corp.example.com`) and **NetBIOS short name**
  (e.g. `CORP`).

---

## 4. Step 1 — Create the identity source and realm

In the UI: **Realms & Proxy → Authentication → + Add Realm**.

1. **Realm name** — an identifier, e.g. `corp-admins`.
2. **Authentication method** — you can start with **Local password** (to import the
   user list now) and switch to **Directory-delegated** after the join, or pick
   **Directory-delegated** straight away.
3. **Identity source** (the AD connection):
   - **Host / port** — a Domain Controller, `389` (or `636` for LDAPS).
   - **Base DN** — e.g. `DC=corp,DC=example,DC=com`.
   - **Bind DN + password** — a read-only service account is enough. The password is
     stored **AES-256-GCM encrypted** and never returned by the API.
   - **Login attribute** — for delegated auth set this to **`sAMAccountName`**, or use
     `userPrincipalName` with **Strip @domain** enabled. `ntlm_auth` authenticates on
     the short username (`sAMAccountName`), e.g. `jsmith`, not `jsmith@corp.example.com`.
4. **Short domain** (delegated only) — the NetBIOS name, e.g. `CORP`. This is passed to
   `ntlm_auth --domain`.
5. Use **Test** on the realm row to confirm the bind works.

Leave it as **Local password** for now if you want to import users before the join —
that path works immediately.

---

## 5. Step 2 — Join the host to the domain (`provision-ad.sh`)

This is the step outside the UI. Run it **on the RADIUS host, as root**. It is opt-in
and is **not** run by `install.sh` or `upgrade.sh`.

```bash
sudo AD_REALM=CORP.EXAMPLE.COM AD_SHORT_DOMAIN=CORP bash deploy/provision-ad.sh
```

The **View setup steps** button on a delegated realm (Authentication tab) shows this
command pre-filled with your realm's values — copy it from there.

### Inputs (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `AD_REALM` | **yes** | Kerberos realm = AD DNS domain, UPPERCASE (e.g. `CORP.EXAMPLE.COM`) |
| `AD_SHORT_DOMAIN` | **yes** | NetBIOS short/workgroup name (e.g. `CORP`) |
| `AD_DC` | no | A specific DC hostname; omit to let DNS SRV auto-discover |
| `AD_JOIN_USER` | no | AD account used for the join (default `Administrator`) |
| `SKIP_JOIN` | no | `=1` to **only (re)wire FreeRADIUS** and skip the join (host already joined) |

### What it does, in order

1. Installs `samba`, `winbind`, `krb5-user`, `libnss-winbind`, `libpam-winbind`.
2. Writes `/etc/krb5.conf` and `/etc/samba/smb.conf` (`security = ads`) — backing up
   any existing files.
3. Runs **`net ads join`** — this is **interactive**: it prompts you to type `JOIN` to
   confirm, then asks for the `AD_JOIN_USER` password. **This creates a machine account
   in AD.**
4. Enables and starts `winbind`, and adds the `freerad` user to the `winbindd_priv`
   group (so `ntlm_auth` can read the privileged winbind pipe).
5. Verifies the trust with `wbinfo -t`.
6. Wires FreeRADIUS: creates `mods-available/mschap_ntlm` (an `mschap` instance whose
   `ntlm_auth` directive validates MS-CHAPv2 against the DC), enables it, and adds an
   `Auth-Type NTLM-Auth { mschap_ntlm }` block to the `default` site.
7. Validates (`freeradius -C`) and reloads FreeRADIUS.

If FreeRADIUS isn't installed yet, install it first (`deploy/install.sh`) and re-run
with `SKIP_JOIN=1` to do only the FreeRADIUS wiring.

---

## 6. Step 3 — Verify

On the host:

```bash
wbinfo -t                       # → "checking the trust secret ... succeeded"
getent passwd 'CORP\jsmith'     # winbind can resolve a domain user (optional)
```

Test a real login end-to-end against FreeRADIUS (uses the subscriber's **real AD
password**):

```bash
radtest -t mschap jsmith 'RealADPassw0rd' 127.0.0.1 0 testing123
# → Access-Accept, carrying the realm's plan reply attributes
```

In the UI: the delegated realm's row shows a **host: ready** badge (green) and the
amber "isn't wired yet" banner disappears. Click the badge any time to re-check and
see the individual checks (`ntlm_auth`, FreeRADIUS wiring, winbind trust).

---

## 7. Step 4 — Map groups and import users

With the host joined, set the realm's method to **Directory-delegated** (Edit) if you
haven't already, then:

- **Groups** — map an AD group (matched against each user's `memberOf`) to a MonsterOps
  group / service plan. Unmatched users fall back to the realm's default group.
- **Import users** — choose the **import mode** (Edit → *All matching users* or
  *Selected users only*). In **Selected** mode, the row's **Import users…** button opens
  a picker so you import just the accounts you want (e.g. only admins); sync then keeps
  exactly that set in step and never auto-adds new AD users.

Delegated users are provisioned with **no password** in MonsterOps — only a control
row that routes them to the live DC check. Disabling a user (or their disappearance
from AD) blocks the login without deleting history.

---

## 8. Troubleshooting

**Login fails with `Unknown or invalid value NTLM-Auth for attribute Auth-Type`**
(the log may show it quoted-printable, as `=22NTLM-Auth=22`). FreeRADIUS doesn't have
the `Auth-Type NTLM-Auth` block — the host isn't wired. Run `provision-ad.sh` (or
re-run with `SKIP_JOIN=1` if already joined). This is exactly what the **host: ready**
badge checks for.

**`net ads join` fails.** Almost always DNS, time, or credentials:
- `host -t SRV _ldap._tcp.CORP.EXAMPLE.COM` should list your DCs.
- Clock skew > 5 min → Kerberos preauth fails. Sync time to the DC.
- Confirm the join account may add computers to the target OU.

**`wbinfo -t` fails after a successful join.** Restart winbind
(`systemctl restart winbind`) and check `journalctl -u winbind -n 30`. If the
`winbindd_priv` group didn't exist at join time, re-run the script to add `freerad`.

**Delegated login selects MS-CHAP instead of NTLM-Auth.** In
`sites-available/default`, `sql` must run **after** `mschap` in `authorize{}` so the
`Auth-Type := NTLM-Auth` MonsterOps writes wins. The script warns if it can't confirm
this; move `sql` below `mschap` if needed.

**Users authenticate with the wrong username form.** `ntlm_auth` expects
`sAMAccountName`. Set the identity source's **Login attribute** to `sAMAccountName`, or
`userPrincipalName` with **Strip @domain** on.

Logs: `journalctl -u freeradius -n 50`, or run `freeradius -X` in the foreground for a
verbose single-request trace.

---

## 9. Removing delegated auth / leaving the domain

- **Per realm:** switch the method back to **Local password** (Edit). Existing users
  keep working once they have a local password again.
- **Host level:** disable the FreeRADIUS wiring by removing
  `mods-enabled/mschap_ntlm` and the `Auth-Type NTLM-Auth` block from
  `sites-available/default` (the script left `.monsterops.bak.*` backups), then reload
  FreeRADIUS. To leave the domain entirely: `net ads leave -U Administrator` (removes
  the machine account), then stop/disable `winbind`.

---

## 10. Reference — what the script changes

| Path | Change |
|---|---|
| Packages | `samba`, `winbind`, `krb5-user`, `libnss-winbind`, `libpam-winbind`, `acl` |
| `/etc/krb5.conf` | Kerberos realm config (previous file backed up) |
| `/etc/samba/smb.conf` | `security = ads`, realm, workgroup, idmap (previous file backed up) |
| Active Directory | A **machine account** for this host (via `net ads join`) |
| `winbindd_priv` group | `freerad` added (privileged-pipe access for `ntlm_auth`) |
| `mods-available/mschap_ntlm` + `mods-enabled/` symlink | Delegated MS-CHAPv2 instance |
| `sites-available/default` | `Auth-Type NTLM-Auth { mschap_ntlm }` in `authenticate{}` (backed up) |

Everything MonsterOps-side (realms, identity sources, group maps, imports, the
readiness badge) works and can be tested **before** this step — only real-AD-password
login depends on the join.
