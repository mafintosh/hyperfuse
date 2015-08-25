var stream = require('stream')
var duplexify = require('duplexify')

module.exports = rfuse

function rfuse (bindings) {
  var input = stream.PassThrough()
  var output = stream.PassThrough()

  loop()

  function onmessage (buf) {
    var id = buf.readUInt16BE(0)
    var method = buf[2]

    var pathLen = buf.readUInt16BE(3)
    var path = buf.toString('utf-8', 5, 5 + pathLen)
    var offset = 5 + pathLen + 1

    switch (method) {
      case 1:
        bindings.getattr(path, writeStat(output, id))
        break

      case 2:
        bindings.readdir(path, writeDirs(output, id))
        break

      case 3:
        var fd = buf.readUInt16BE(offset)
        var len = buf.readUInt32BE(offset + 2)
        var pos = buf.readUInt32BE(offset + 6)
        var result = new Buffer(10 + len) // TODO: reuse buffers
        bindings.read(path, fd, result.slice(10), len, pos, writeRead(output, id, result))
        break

      case 4:
        bindings.open(path, buf.readUInt16BE(offset), writeFd(output, id))
        break

      case 5:
        bindings.truncate(path, buf.readUInt32BE(offset), writeAck(output, id))
        break

      case 6:
        bindings.create(path, buf.readUInt16BE(offset), writeFd(output, id))
        break

      case 7:
        bindings.unlink(path, writeAck(output, id))
        break

      case 8:
        var fd = buf.readUInt16BE(offset)
        var pos = buf.readUInt32BE(offset + 2)
        var writes = buf.slice(offset + 6)
        bindings.write(path, fd, writes, writes.length, pos, writeWrite(output, id))
        break

      case 9:
        var mode = buf.readUInt16BE(offset)
        bindings.chmod(path, mode, writeAck(output, id))
        break

      case 10:
        var uid = buf.readUInt16BE(offset)
        var gid = buf.readUInt16BE(offset + 2)
        bindings.chown(path, uid, gid, writeAck(output, id))
        break

      case 11:
        var fd = buf.readUInt16BE(offset)
        bindings.release(path, fd, writeAck(output, id))
        break

      case 12:
        var mode = buf.readUInt16BE(offset)
        bindings.mkdir(path, mode, writeAck(output, id))
        break
    }
  }

  function loop () {
    read(input, 4, function (len) {
      read(input, len.readUInt32BE(0), function (buf) {
        onmessage(buf)
        loop()
      })
    })
  }

  return duplexify(input, output)
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
  return err.errno
}

function alloc (err, id, len) {
  var buf = new Buffer((err ? 0 : len) + 10)
  buf.writeUInt32BE(buf.length - 4, 0)
  buf.writeUInt16BE(id, 4)
  buf.writeInt32BE(errno(err), 6)
  return buf
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
    if (!err) {
      for (var i = 0; i < dirs.length; i++) len += 3 + Buffer.byteLength(dirs[i])
    }
    var buf = alloc(err, id, len)
    if (err) return sock.write(buf)
    var offset = 10
    for (var i = 0; i < dirs.length; i++) {
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
  return function (err, len)  {
    var ret = typeof err === 'number' ? err : (errno(err) || len || 0)
    sock.write(alloc(len, id, 0))
  }
}

function writeAck (sock, id) {
  return function (err) {
    sock.write(alloc(err, id, 0))
  }
}
