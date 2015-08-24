var net = require('net')

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
  return -err.errno
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
    for (var i = 0; i < dirs.length; i++) len += 3 + Buffer.byteLength(dirs[i])
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

module.exports = function (port, bindings) {
  var server = net.createServer(function loop (sock) {
    read(sock, 4, function (len) {
      read(sock, len.readUInt32BE(0), function (buf) {
        var id = buf.readUInt16BE(0)
        var method = buf[2]

        var pathLen = buf.readUInt16BE(3)
        var path = buf.toString('utf-8', 5, 5 + pathLen)
        // next is 5 + pathLen + 1

        switch (method) {
          case 1:
            bindings.getattr(path, writeStat(sock, id))
            break

          case 2:
            bindings.readdir(path, writeDirs(sock, id))
            break
        }

        loop(sock)

        // console.log(id, method)
        // var path = container.readUInt16BE(3)
      })
    })
  })

  server.listen(port)
  return server
}

var fs = require('fs')

module.exports(10000, {
  readdir: function (path, cb) {
    cb(null, ['test-test', 'test'])
  },
  getattr: function (path, cb) {
    if (path === '/test-test') return fs.stat(__filename, cb)
    if (path === '/test') return fs.stat(__filename, cb)
    fs.stat('tmp' + path, cb)
  }
})