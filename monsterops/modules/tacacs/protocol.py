
from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass, field

TAC_PLUS_MAJOR_VERSION = 0xC
TAC_PLUS_MINOR_VERSION_DEFAULT = 0x0
TAC_PLUS_MINOR_VERSION_ONE = 0x1

TAC_PLUS_AUTHEN = 0x01
TAC_PLUS_AUTHOR = 0x02
TAC_PLUS_ACCT = 0x03

TAC_PLUS_UNENCRYPTED_FLAG = 0x01
TAC_PLUS_SINGLE_CONNECT_FLAG = 0x04

HEADER_SIZE = 12

TAC_PLUS_AUTHEN_LOGIN = 0x01
TAC_PLUS_AUTHEN_CHPASS = 0x02
TAC_PLUS_AUTHEN_SENDAUTH = 0x04

TAC_PLUS_AUTHEN_TYPE_ASCII = 0x01
TAC_PLUS_AUTHEN_TYPE_PAP = 0x02
TAC_PLUS_AUTHEN_TYPE_CHAP = 0x03
TAC_PLUS_AUTHEN_TYPE_MSCHAP = 0x05
TAC_PLUS_AUTHEN_TYPE_MSCHAPV2 = 0x06

TAC_PLUS_AUTHEN_SVC_NONE = 0x00
TAC_PLUS_AUTHEN_SVC_LOGIN = 0x01
TAC_PLUS_AUTHEN_SVC_ENABLE = 0x02

TAC_PLUS_PRIV_LVL_MIN = 0x00
TAC_PLUS_PRIV_LVL_USER = 0x01
TAC_PLUS_PRIV_LVL_ROOT = 0x0F
TAC_PLUS_PRIV_LVL_MAX = 0x0F

TAC_PLUS_AUTHEN_STATUS_PASS = 0x01
TAC_PLUS_AUTHEN_STATUS_FAIL = 0x02
TAC_PLUS_AUTHEN_STATUS_GETDATA = 0x03
TAC_PLUS_AUTHEN_STATUS_GETUSER = 0x04
TAC_PLUS_AUTHEN_STATUS_GETPASS = 0x05
TAC_PLUS_AUTHEN_STATUS_RESTART = 0x06
TAC_PLUS_AUTHEN_STATUS_ERROR = 0x07
TAC_PLUS_AUTHEN_STATUS_FOLLOW = 0x21

TAC_PLUS_REPLY_FLAG_NOECHO = 0x01
TAC_PLUS_CONTINUE_FLAG_ABORT = 0x01

TAC_PLUS_AUTHEN_METH_NOT_SET = 0x00
TAC_PLUS_AUTHEN_METH_NONE = 0x01
TAC_PLUS_AUTHEN_METH_KRB5 = 0x02
TAC_PLUS_AUTHEN_METH_LINE = 0x03
TAC_PLUS_AUTHEN_METH_ENABLE = 0x04
TAC_PLUS_AUTHEN_METH_LOCAL = 0x05
TAC_PLUS_AUTHEN_METH_TACACSPLUS = 0x06
TAC_PLUS_AUTHEN_METH_GUEST = 0x08
TAC_PLUS_AUTHEN_METH_RADIUS = 0x10
TAC_PLUS_AUTHEN_METH_KRB4 = 0x11
TAC_PLUS_AUTHEN_METH_RCMD = 0x20

TAC_PLUS_AUTHOR_STATUS_PASS_ADD = 0x01
TAC_PLUS_AUTHOR_STATUS_PASS_REPL = 0x02
TAC_PLUS_AUTHOR_STATUS_FAIL = 0x10
TAC_PLUS_AUTHOR_STATUS_ERROR = 0x11
TAC_PLUS_AUTHOR_STATUS_FOLLOW = 0x21

TAC_PLUS_ACCT_FLAG_START = 0x02
TAC_PLUS_ACCT_FLAG_STOP = 0x04
TAC_PLUS_ACCT_FLAG_WATCHDOG = 0x08

TAC_PLUS_ACCT_STATUS_SUCCESS = 0x01
TAC_PLUS_ACCT_STATUS_ERROR = 0x02
TAC_PLUS_ACCT_STATUS_FOLLOW = 0x21


def make_version(minor: int = TAC_PLUS_MINOR_VERSION_DEFAULT) -> int:
    return (TAC_PLUS_MAJOR_VERSION << 4) | (minor & 0x0F)


def version_major(version: int) -> int:
    return (version >> 4) & 0x0F


def version_minor(version: int) -> int:
    return version & 0x0F




@dataclass
class Header:
    version: int
    type: int
    seq_no: int
    flags: int
    session_id: int
    length: int

    def pack(self) -> bytes:
        return struct.pack(
            "!BBBBII",
            self.version,
            self.type,
            self.seq_no,
            self.flags,
            self.session_id,
            self.length,
        )

    @classmethod
    def unpack(cls, data: bytes) -> Header:
        if len(data) < HEADER_SIZE:
            raise ValueError("TACACS+ header too short")
        version, type_, seq_no, flags, session_id, length = struct.unpack(
            "!BBBBII", data[:HEADER_SIZE]
        )
        return cls(version, type_, seq_no, flags, session_id, length)




def pseudo_pad(session_id: int, secret: bytes, version: int, seq_no: int, length: int) -> bytes:
    prefix = struct.pack("!I", session_id) + secret + struct.pack("!BB", version, seq_no)
    pad = b""
    block = b""
    while len(pad) < length:
        block = hashlib.md5(prefix + block).digest()
        pad += block
    return pad[:length]


def obfuscate(body: bytes, session_id: int, secret: bytes, version: int, seq_no: int) -> bytes:
    if not secret:
        return body
    pad = pseudo_pad(session_id, secret, version, seq_no, len(body))
    return bytes(b ^ p for b, p in zip(body, pad))


deobfuscate = obfuscate




def build_packet(header: Header, body: bytes, secret: bytes) -> bytes:
    flags = header.flags
    if secret:
        payload = obfuscate(body, header.session_id, secret, header.version, header.seq_no)
        flags &= ~TAC_PLUS_UNENCRYPTED_FLAG
    else:
        payload = body
        flags |= TAC_PLUS_UNENCRYPTED_FLAG
    hdr = Header(header.version, header.type, header.seq_no, flags, header.session_id, len(body))
    return hdr.pack() + payload


def parse_packet(data: bytes, secret: bytes) -> tuple[Header, bytes]:
    header = Header.unpack(data)
    body_enc = data[HEADER_SIZE : HEADER_SIZE + header.length]
    if len(body_enc) < header.length:
        raise ValueError("TACACS+ body truncated")
    if header.flags & TAC_PLUS_UNENCRYPTED_FLAG:
        body = body_enc
    else:
        body = deobfuscate(body_enc, header.session_id, secret, header.version, header.seq_no)
    return header, body




@dataclass
class AuthenStart:
    action: int
    priv_lvl: int
    authen_type: int
    authen_service: int
    user: bytes = b""
    port: bytes = b""
    rem_addr: bytes = b""
    data: bytes = b""

    def pack(self) -> bytes:
        return (
            struct.pack(
                "!BBBBBBBB",
                self.action,
                self.priv_lvl,
                self.authen_type,
                self.authen_service,
                len(self.user),
                len(self.port),
                len(self.rem_addr),
                len(self.data),
            )
            + self.user
            + self.port
            + self.rem_addr
            + self.data
        )

    @classmethod
    def unpack(cls, body: bytes) -> AuthenStart:
        if len(body) < 8:
            raise ValueError("AUTHEN START too short")
        action, priv_lvl, authen_type, authen_service, ul, pl, ral, dl = struct.unpack(
            "!BBBBBBBB", body[:8]
        )
        off = 8
        user, off = body[off : off + ul], off + ul
        port, off = body[off : off + pl], off + pl
        rem_addr, off = body[off : off + ral], off + ral
        data, off = body[off : off + dl], off + dl
        if off != len(body):
            raise ValueError("AUTHEN START length mismatch")
        return cls(action, priv_lvl, authen_type, authen_service, user, port, rem_addr, data)


@dataclass
class AuthenReply:
    status: int
    flags: int = 0
    server_msg: bytes = b""
    data: bytes = b""

    def pack(self) -> bytes:
        return (
            struct.pack("!BBHH", self.status, self.flags, len(self.server_msg), len(self.data))
            + self.server_msg
            + self.data
        )

    @classmethod
    def unpack(cls, body: bytes) -> AuthenReply:
        if len(body) < 6:
            raise ValueError("AUTHEN REPLY too short")
        status, flags, sml, dl = struct.unpack("!BBHH", body[:6])
        off = 6
        server_msg, off = body[off : off + sml], off + sml
        data, off = body[off : off + dl], off + dl
        if off != len(body):
            raise ValueError("AUTHEN REPLY length mismatch")
        return cls(status, flags, server_msg, data)


@dataclass
class AuthenContinue:
    flags: int = 0
    user_msg: bytes = b""
    data: bytes = b""

    def pack(self) -> bytes:
        return (
            struct.pack("!HHB", len(self.user_msg), len(self.data), self.flags)
            + self.user_msg
            + self.data
        )

    @classmethod
    def unpack(cls, body: bytes) -> AuthenContinue:
        if len(body) < 5:
            raise ValueError("AUTHEN CONTINUE too short")
        uml, dl, flags = struct.unpack("!HHB", body[:5])
        off = 5
        user_msg, off = body[off : off + uml], off + uml
        data, off = body[off : off + dl], off + dl
        if off != len(body):
            raise ValueError("AUTHEN CONTINUE length mismatch")
        return cls(flags, user_msg, data)




@dataclass
class AuthorRequest:
    authen_method: int
    priv_lvl: int
    authen_type: int
    authen_service: int
    user: bytes = b""
    port: bytes = b""
    rem_addr: bytes = b""
    args: list[bytes] = field(default_factory=list)

    def pack(self) -> bytes:
        arg_lens = bytes(len(a) for a in self.args)
        head = struct.pack(
            "!BBBBBBBB",
            self.authen_method,
            self.priv_lvl,
            self.authen_type,
            self.authen_service,
            len(self.user),
            len(self.port),
            len(self.rem_addr),
            len(self.args),
        )
        return head + arg_lens + self.user + self.port + self.rem_addr + b"".join(self.args)

    @classmethod
    def unpack(cls, body: bytes) -> AuthorRequest:
        if len(body) < 8:
            raise ValueError("AUTHOR REQUEST too short")
        method, priv_lvl, authen_type, service, ul, pl, ral, arg_cnt = struct.unpack(
            "!BBBBBBBB", body[:8]
        )
        off = 8
        if len(body) < off + arg_cnt:
            raise ValueError("AUTHOR REQUEST truncated arg-length table")
        arg_lens = list(body[off : off + arg_cnt])
        off += arg_cnt
        user, off = body[off : off + ul], off + ul
        port, off = body[off : off + pl], off + pl
        rem_addr, off = body[off : off + ral], off + ral
        args = []
        for alen in arg_lens:
            args.append(body[off : off + alen])
            off += alen
        if off != len(body):
            raise ValueError("AUTHOR REQUEST length mismatch")
        return cls(method, priv_lvl, authen_type, service, user, port, rem_addr, args)


@dataclass
class AuthorResponse:
    status: int
    args: list[bytes] = field(default_factory=list)
    server_msg: bytes = b""
    data: bytes = b""

    def pack(self) -> bytes:
        arg_lens = bytes(len(a) for a in self.args)
        head = struct.pack(
            "!BBHH", self.status, len(self.args), len(self.server_msg), len(self.data)
        )
        return head + arg_lens + self.server_msg + self.data + b"".join(self.args)

    @classmethod
    def unpack(cls, body: bytes) -> AuthorResponse:
        if len(body) < 6:
            raise ValueError("AUTHOR RESPONSE too short")
        status, arg_cnt, sml, dl = struct.unpack("!BBHH", body[:6])
        off = 6
        if len(body) < off + arg_cnt:
            raise ValueError("AUTHOR RESPONSE truncated arg-length table")
        arg_lens = list(body[off : off + arg_cnt])
        off += arg_cnt
        server_msg, off = body[off : off + sml], off + sml
        data, off = body[off : off + dl], off + dl
        args = []
        for alen in arg_lens:
            args.append(body[off : off + alen])
            off += alen
        if off != len(body):
            raise ValueError("AUTHOR RESPONSE length mismatch")
        return cls(status, args, server_msg, data)




def _split_av(arg: str) -> tuple[str, str, bool]:
    eq = arg.find("=")
    star = arg.find("*")
    if eq == -1 and star == -1:
        return arg, "", False
    if star == -1 or (eq != -1 and eq < star):
        return arg[:eq], arg[eq + 1 :], False
    return arg[:star], arg[star + 1 :], True


def parse_av_pairs(args: list[bytes]) -> list[tuple[str, str, bool]]:
    return [_split_av(raw.decode("utf-8", "replace")) for raw in args]




@dataclass
class AcctRequest:
    flags: int
    authen_method: int
    priv_lvl: int
    authen_type: int
    authen_service: int
    user: bytes = b""
    port: bytes = b""
    rem_addr: bytes = b""
    args: list[bytes] = field(default_factory=list)

    def pack(self) -> bytes:
        arg_lens = bytes(len(a) for a in self.args)
        head = struct.pack(
            "!BBBBBBBBB",
            self.flags,
            self.authen_method,
            self.priv_lvl,
            self.authen_type,
            self.authen_service,
            len(self.user),
            len(self.port),
            len(self.rem_addr),
            len(self.args),
        )
        return head + arg_lens + self.user + self.port + self.rem_addr + b"".join(self.args)

    @classmethod
    def unpack(cls, body: bytes) -> AcctRequest:
        if len(body) < 9:
            raise ValueError("ACCT REQUEST too short")
        flags, method, priv_lvl, atype, service, ul, pl, ral, arg_cnt = struct.unpack(
            "!BBBBBBBBB", body[:9]
        )
        off = 9
        if len(body) < off + arg_cnt:
            raise ValueError("ACCT REQUEST truncated arg-length table")
        arg_lens = list(body[off : off + arg_cnt])
        off += arg_cnt
        user, off = body[off : off + ul], off + ul
        port, off = body[off : off + pl], off + pl
        rem_addr, off = body[off : off + ral], off + ral
        args = []
        for alen in arg_lens:
            args.append(body[off : off + alen])
            off += alen
        if off != len(body):
            raise ValueError("ACCT REQUEST length mismatch")
        return cls(flags, method, priv_lvl, atype, service, user, port, rem_addr, args)


@dataclass
class AcctReply:
    status: int
    server_msg: bytes = b""
    data: bytes = b""

    def pack(self) -> bytes:
        return (
            struct.pack("!HHB", len(self.server_msg), len(self.data), self.status)
            + self.server_msg
            + self.data
        )

    @classmethod
    def unpack(cls, body: bytes) -> AcctReply:
        if len(body) < 5:
            raise ValueError("ACCT REPLY too short")
        sml, dl, status = struct.unpack("!HHB", body[:5])
        off = 5
        server_msg, off = body[off : off + sml], off + sml
        data, off = body[off : off + dl], off + dl
        if off != len(body):
            raise ValueError("ACCT REPLY length mismatch")
        return cls(status, server_msg, data)
