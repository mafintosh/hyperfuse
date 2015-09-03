var stream = require('stream')
var duplexify = require('duplexify')
var bitfield = require('bitfield')

var METHODS = [
  'init',
  'getattr',
  'readdir',
  'read',
  'open',
  'truncate',
  'create',
  'unlink',
  'write',
  'chmod',
  'chown',
  'release',
  'mkdir',
  'rmdir',
  'utimens',
  'rename',
  'symlink',
  'readlink',
  'link',
  'access',
  'statfs',
  'fgetattr',
  'flush',
  'fsync',
  'fsyncdir',
  'ftruncate',
  'mknod',
  'setxattr',
  'getxattr',
  'opendir',
  'releasedir'
]

module.exports = hyperfuse

function hyperfuse (bindings) {
  var input = stream.PassThrough()
  var output = stream.PassThrough()
  var remote = duplexify(input, output)
  var methods = bitfield(40)

  METHODS.forEach(function (m, i) {
    if (bindings[m]) methods.set(i)
  })

  methods.set(0) // init is always defined
  output.write(methods.buffer)

  loop()

  return remote

  function init (mnt, cb) {
    remote.path = mnt
    remote.emit('mount', mnt)
    if (bindings.init) bindings.init(mnt, cb)
    else cb()
  }

  function onmessage (buf) {
    var id = buf.readUInt16BE(0)
    var method = buf[2]

    var pathLen = buf.readUInt16BE(3)
    var path = buf.toString('utf-8', 5, 5 + pathLen)
    var offset = 5 + pathLen + 1

    switch (method) {
      case 0: return init(path, writeAck(output, id))
      case 1: return bindings.getattr(path, writeStat(output, id))
      case 2: return bindings.readdir(path, writeDirs(output, id))
      case 3: return onread(buf, path, offset, id)
      case 4: return bindings.open(path, buf.readUInt16BE(offset), writeFd(output, id))
      case 5: return bindings.truncate(path, buf.readUInt32BE(offset), writeAck(output, id))
      case 6: return bindings.create(path, buf.readUInt16BE(offset), writeFd(output, id))
      case 7: return bindings.unlink(path, writeAck(output, id))
      case 8: return onwrite(buf, path, offset, id)
      case 9: return bindings.chmod(path, buf.readUInt16BE(offset), writeAck(output, id))
      case 10: return bindings.chown(path, buf.readUInt16BE(offset), buf.readUInt16BE(offset + 2), writeAck(output, id))
      case 11: return bindings.release(path, buf.readUInt16BE(offset), writeAck(output, id))
      case 12: return bindings.mkdir(path, buf.readUInt16BE(offset), writeAck(output, id))
      case 13: return bindings.rmdir(path, writeAck(output, id))
      case 14: return bindings.utimens(path, readDate(buf, offset), readDate(buf, offset + 4), writeAck(output, id))
      case 15: return bindings.rename(path, readString(buf, offset), writeAck(output, id))
      case 16: return bindings.symlink(path, readString(buf, offset), writeAck(output, id))
      case 17: return bindings.readlink(path, writeLink(output, id))
      case 18: return bindings.link(path, readString(buf, offset), writeAck(output, id))
      case 19: return bindings.access(path, buf.readUInt16BE(offset), writeFd(output, id))
      case 20: return bindings.statfs(path, writeStatfs(output, id))
      case 21: return bindings.fgetattr(path, buf.readUInt16BE(offset), writeStat(output, id))
      case 22: return bindings.flush(path, buf.readUInt16BE(offset), writeAck(output, id))
      case 23: return bindings.fsync(path, buf.readUInt16BE(offset), buf.readUInt16BE(offset + 2), writeAck(output, id))
      case 24: return bindings.fsyncdir(path, buf.readUInt16BE(offset), buf.readUInt16BE(offset + 2), writeAck(output, id))
      case 25: return bindings.ftruncate(path, buf.readUInt16BE(offset), buf.readUInt32BE(offset + 2), writeAck(output, id))
      case 26: return bindings.mknod(path, buf.readUInt16BE(offset), buf.readUInt32BE(offset + 2), writeAck(output, id))
      case 27: return onsetxattr(buf, path, offset, id)
      case 28: return ongetxattr(buf, path, offset, id)
      case 29: return bindings.opendir(path, buf.readUInt16BE(offset), writeFd(output, id))
      case 30: return bindings.release(path, buf.readUInt16BE(offset), writeAck(output, id))
    }
  }

  function ongetxattr (buf, path, offset, id) {
    var name = readString(buf, offset)
    offset += readString.bytes
    var pos = buf.readUInt32BE(offset)
    offset += 4
    var data = buf.slice(offset)
    bindings.getxattr(path, name, data, data.length, pos, writeAck(output, id))
  }

  function onsetxattr (buf, path, offset, id) {
    var name = readString(buf, offset)
    offset += readString.bytes
    var flags = buf.readUInt16BE(offset)
    offset += 2
    var pos = buf.readUInt32BE(offset)
    offset += 4
    var data = buf.slice(offset)
    bindings.setxattr(path, name, data, data.length, pos, flags, writeAck(output, id))
  }

  function onread (buf, path, offset, id) {
    var fd = buf.readUInt16BE(offset)
    var len = buf.readUInt32BE(offset + 2)
    var pos = buf.readUInt32BE(offset + 6)
    var result = new Buffer(10 + len) // TODO: reuse buffers
    bindings.read(path, fd, result.slice(10), len, pos, writeRead(output, id, result))
  }

  function onwrite (buf, path, offset, id) {
    var fd = buf.readUInt16BE(offset)
    var pos = buf.readUInt32BE(offset + 2)
    var writes = buf.slice(offset + 6)
    bindings.write(path, fd, writes, writes.length, pos, writeWrite(output, id))
  }

  function loop () {
    read(input, 4, function (len) {
      read(input, len.readUInt32BE(0), function (buf) {
        onmessage(buf)
        loop()
      })
    })
  }
}

function readString (buf, offset) {
  var strLen = buf.readUInt16BE(offset)
  readString.bytes = strLen + 2 + 1
  return buf.toString('utf-8', offset + 2, offset + 2 + strLen)
}

function readDate (buf, offset) {
  return new Date(1000 * buf.readUInt32BE(offset))
}

function read (sock, num, cb) {
  var b = sock.read(num)
  if (b) return cb(b)
  sock.once('readable', function () {
    read(sock, num, cb)
  })
}

function errno (err) {
  if (!err) return 0
  if (typeof err === 'number') return err
  return err.errno || -1
}

function alloc (err, id, len) {
  var buf = new Buffer((err ? 0 : len) + 10)
  buf.writeUInt32BE(buf.length - 4, 0)
  buf.writeUInt16BE(id, 4)
  buf.writeInt32BE(errno(err), 6)
  return buf
}

function writeStatfs (sock, id) {
  return function (err, st) {
    var buf = alloc(err, id, 11 * 4)
    if (err) return sock.write(buf)

    var offset = 10
    buf.writeUInt32BE(st.bsize, offset)
    offset += 4
    buf.writeUInt32BE(st.frsize, offset)
    offset += 4
    buf.writeUInt32BE(st.blocks, offset)
    offset += 4
    buf.writeUInt32BE(st.bfree, offset)
    offset += 4
    buf.writeUInt32BE(st.bavail, offset)
    offset += 4
    buf.writeUInt32BE(st.files, offset)
    offset += 4
    buf.writeUInt32BE(st.ffree, offset)
    offset += 4
    buf.writeUInt32BE(st.favail, offset)
    offset += 4
    buf.writeUInt32BE(st.fsid, offset)
    offset += 4
    buf.writeUInt32BE(st.flag, offset)
    offset += 4
    buf.writeUInt32BE(st.namemax, offset)
    offset += 4

    sock.write(buf)
  }
}

function writeLink (sock, id) {
  return function (err, link) {
    var len = link ? Buffer.byteLength(link) : 0
    var buf = alloc(err, id, 2 + len + 1)
    if (err) return sock.write(buf)
    buf.writeUInt16BE(len, 10)
    buf.write(link, 12, 12 + len)
    buf[12 + len] = 0
    sock.write(buf)
  }
}

function writeStat (sock, id) {
  return function (err, st) {
    var buf = alloc(err, id, 13 * 4)
    if (err) return sock.write(buf)

    var offset = 10
    buf.writeUInt32BE(st.dev, offset)
    offset += 4
    buf.writeUInt32BE(st.mode, offset)
    offset += 4
    buf.writeUInt32BE(st.nlink, offset)
    offset += 4
    buf.writeUInt32BE(st.uid, offset)
    offset += 4
    buf.writeUInt32BE(st.gid, offset)
    offset += 4
    buf.writeUInt32BE(st.rdev, offset)
    offset += 4
    buf.writeUInt32BE(st.blksize, offset)
    offset += 4
    buf.writeUInt32BE(st.ino, offset)
    offset += 4
    buf.writeUInt32BE(st.size, offset)
    offset += 4
    buf.writeUInt32BE(st.blocks, offset)
    offset += 4
    buf.writeUInt32BE(st.atime.getTime() / 1000, offset)
    offset += 4
    buf.writeUInt32BE(st.mtime.getTime() / 1000, offset)
    offset += 4
    buf.writeUInt32BE(st.ctime.getTime() / 1000, offset)
    offset += 4

    sock.write(buf)
  }
}

function writeDirs (sock, id) {
  return function (err, dirs) {
    var len = 0
    var i
    if (!err) {
      for (i = 0; i < dirs.length; i++) len += 3 + Buffer.byteLength(dirs[i])
    }
    var buf = alloc(err, id, len)
    if (err) return sock.write(buf)
    var offset = 10
    for (i = 0; i < dirs.length; i++) {
      var l = Buffer.byteLength(dirs[i])
      buf.writeUInt16BE(l, offset)
      buf.write(dirs[i], offset + 2)
      buf[offset + 2 + l] = 0
      offset += 3 + l
    }
    sock.write(buf)
  }
}

function writeRead (sock, id, result) {
  return function (err, len) {
    var ret = typeof err === 'number' ? err : (errno(err) || len || 0)
    var bufLen = (ret ? ret : 0) + 10
    result = result.slice(0, bufLen)
    result.writeUInt32BE(result.length - 4, 0)
    result.writeUInt16BE(id, 4)
    result.writeInt32BE(ret, 6)
    sock.write(result)
  }
}

function writeFd (sock, id) {
  return function (err, fd) {
    var buf = alloc(err, id, 2)
    if (err) return sock.write(buf)
    buf.writeUInt16BE(fd, 10)
    sock.write(buf)
  }
}

function writeWrite (sock, id) {
  return function (err, len) {
    var ret = typeof err === 'number' ? err : (errno(err) || len || 0)
    sock.write(alloc(ret, id, 0))
  }
}

function writeAck (sock, id) {
  return function (err) {
    sock.write(alloc(err, id, 0))
  }
}
