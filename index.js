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

function writeStat (sock, id) {
  return function (err, st) {
    var buf = new Buffer((err ? 0 : 13 * 4) + 10)
    buf.writeUInt32BE(buf.length - 4, 0)
    buf.writeUInt16BE(id, 4)
    buf.writeInt32BE(errno(err), 6)

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

module.exports = function (port, bindings) {
  var server = net.createServer(function loop (sock) {
    read(sock, 4, function (len) {
      read(sock, len.readUInt32BE(0), function (buf) {
        var id = buf.readUInt16BE(0)
        var method = buf[2]

        var pathLen = buf.readUInt16BE(3)
        var path = buf.toString('utf-8', 5, 5 + pathLen)

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
  getattr: function (path, cb) {
    if (path === '/test-test') return fs.stat(__filename, cb)
    fs.stat('tmp' + path, cb)
  }
})