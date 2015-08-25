#define FUSE_USE_VERSION 29
#define RFUSE_GETATTR 1
#define RFUSE_READDIR 2
#define RFUSE_READ 3
#define RFUSE_OPEN 4
#define RFUSE_TRUNCATE 5

#include <fuse.h>
#include <fuse_opt.h>
#include <fuse_lowlevel.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <string.h>

#include "socket.h"
#include "enc.h"
#include "id_map.h"

#include <unistd.h>

static int rpc_fd_out;
static int rpc_fd_in;
static id_map_t ids;
static struct stat mnt_st;

typedef struct {
  uint8_t method;
  void *result;
  char *buffer;
  uint32_t buffer_length;
  struct fuse_file_info *info;
  fuse_fill_dir_t filler; // for readdir
} rpc_t;

inline static void rpc_parse_getattr (rpc_t *req, char *frame, uint32_t frame_len) {
  uint32_t val_32;
  struct stat *st = (struct stat *) req->result;
  frame = read_uint32(frame, &val_32);
  st->st_dev = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_mode = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_nlink = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_uid = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_gid = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_rdev = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_blksize = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_ino = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_size = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_blocks = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_atimespec.tv_sec = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_mtimespec.tv_sec = val_32;
  frame = read_uint32(frame, &val_32);
  st->st_ctimespec.tv_sec = val_32;
}

inline static void rpc_parse_readdir (rpc_t *req, char *frame, uint32_t frame_len) {
  uint16_t str_len;
  char *str;
  char *offset = frame;

  while (frame - offset < frame_len) {
    frame = read_string(frame, &str, &str_len);
    req->filler(req->result, str, NULL, 0);
  }
}

inline static void rpc_parse_open (rpc_t *req, char *frame, uint32_t frame_len) {
  uint16_t fd;
  read_uint16(frame, &fd);
  req->info->fh = fd;
}

inline static int rpc_request (rpc_t *req) {
  char *tmp = req->buffer;
  uint16_t send_id = id_map_alloc(&ids, req);

  // write header
  tmp = write_uint32(tmp, req->buffer_length - 4);
  tmp = write_uint16(tmp, send_id);
  tmp = write_uint8(tmp, req->method);

  // write request
  if (socket_write(rpc_fd_out, req->buffer, req->buffer_length) < 0) return -1;

  // read a response
  char header[10];
  tmp = (char *) &header;
  if (socket_read(rpc_fd_in, tmp, 10) < 0) return -1;

  uint32_t frame_size;
  uint16_t recv_id;
  int32_t ret;

  tmp = read_uint32(tmp, &frame_size);
  tmp = read_uint16(tmp, &recv_id);
  tmp = read_int32(tmp, &ret);

  printf("frame_size is %u, recv_id is %u, return value is %u\n", frame_size, recv_id, ret);

  id_map_free(&ids, send_id);

  frame_size -= 6;

  switch (req->method) {
    case RFUSE_READ: {
      if (frame_size) {
        if (socket_read(rpc_fd_in, req->result, frame_size) < 0) return -1;
      }
      return ret;
    }
    case RFUSE_TRUNCATE: {
      return ret;
    }
  }

  char rem[frame_size];
  tmp = (char *) &rem;
  if (socket_read(rpc_fd_in, tmp, frame_size) < 0) return -1;

  if (ret < 0) return ret;

  switch (req->method) {
    case RFUSE_GETATTR: {
      rpc_parse_getattr(req, tmp, frame_size);
      break;
    }

    case RFUSE_READDIR: {
      rpc_parse_readdir(req, tmp, frame_size);
      break;
    }

    case RFUSE_OPEN: {
      rpc_parse_open(req, tmp, frame_size);
    }
  }

  return 0;
}

static int rfuse_getattr (const char *path, struct stat *st) {
  if (!strcmp(path, "/")) {
    memcpy(st, &mnt_st, sizeof(struct stat));
    return 0;
  }

  uint16_t path_len = strlen(path);
  uint32_t buf_len = 7 + 2 + path_len + 1;
  char buf[buf_len];

  rpc_t req = {
    .method = RFUSE_GETATTR,
    .result = st,
    .buffer = buf,
    .buffer_length = buf_len
  };

  write_string(buf + 7, (char *) path, path_len);
  return rpc_request(&req);
}

static int rfuse_readdir (const char *path, void *fuse_buf, fuse_fill_dir_t filler, off_t offset, struct fuse_file_info *info) {
  uint16_t path_len = strlen(path);
  uint32_t buf_len = 7 + 2 + path_len + 1;
  char buf[buf_len];

  rpc_t req = {
    .method = RFUSE_READDIR,
    .result = fuse_buf,
    .buffer = buf,
    .buffer_length = buf_len,
    .filler = filler
  };

  write_string(buf + 7, (char *) path, path_len);
  return rpc_request(&req);
}

static int rfuse_open (const char *path, struct fuse_file_info *info) {
  uint16_t path_len = strlen(path);
  uint32_t buf_len = 7 + 2 + path_len + 1 + 2;
  char buf[buf_len];

  rpc_t req = {
    .method = RFUSE_OPEN,
    .buffer = buf,
    .buffer_length = buf_len,
    .info = info
  };

  char *tmp = (char *) &buf;
  tmp = write_string(tmp + 7, (char *) path, path_len);
  tmp = write_uint16(tmp, info->flags);
  return rpc_request(&req);
}

static int bindings_truncate (const char *path, off_t size) {
  uint16_t path_len = strlen(path);
  uint32_t buf_len = 7 + 2 + path_len + 1 + 4;
  char buf[buf_len];

  rpc_t req = {
    .method = RFUSE_TRUNCATE,
    .buffer = buf,
    .buffer_length = buf_len
  };

  char *tmp = (char *) &buf;
  tmp = write_string(tmp + 7, (char *) path, path_len);
  tmp = write_uint32(tmp, size);
  return rpc_request(&req);
}

static int rfuse_read (const char *path, char *fuse_buf, size_t len, off_t offset, struct fuse_file_info *info) {
  uint16_t path_len = strlen(path);
  uint32_t buf_len = 7 + 2 + path_len + 1 + 2 + 4 + 4;
  char buf[buf_len];

  rpc_t req = {
    .method = RFUSE_READ,
    .result = fuse_buf,
    .buffer = buf,
    .buffer_length = buf_len,
    .info = info
  };

  char *tmp = (char *) &buf;
  tmp = write_string(tmp + 7, (char *) path, path_len);
  tmp = write_uint16(tmp, info->fh);
  tmp = write_uint32(tmp, len);
  tmp = write_uint32(tmp, offset);
  return rpc_request(&req);
}

static int connect (char *addr) {
  if (!strcmp(addr, "-")) {
    rpc_fd_in = 0;
    rpc_fd_out = 1;
    return 0;
  }

  int len = strlen(addr);
  int colon = len;
  for (int i = 0; i < len; i++) {
    if (*(addr + i) == ':') colon = i;
  }

  *(addr + colon) = '\0';
  int port = colon < len ? atoi(addr + colon + 1) : 10000;
  rpc_fd_in = rpc_fd_out = socket_connect(port, strlen(addr) ? addr : NULL);
  return rpc_fd_in;
}

int main (int argc, char **argv) {
  if (argc < 3) {
    printf("Usage: rfuse [mountpoint] [host:port]\n");
    exit(1);
  }

  char *mnt = argv[1];
  char *addr = argv[2];

  unmount(mnt, 0);
  if (stat(mnt, &mnt_st) < 0) {
    printf("Mountpoint does not exist\n");
    return -1;
  }

  if (connect(addr) < 0) {
    printf("Could not connect to server\n");
    return -2;
  }

  id_map_init(&ids);

  struct fuse_operations ops = {
    .readdir = rfuse_readdir,
    .getattr = rfuse_getattr,
    .read = rfuse_read,
    .open = rfuse_open
  };

  struct fuse_args args = FUSE_ARGS_INIT(argc - 2, argv + 2);
  struct fuse_chan *ch = fuse_mount(mnt, &args);

  if (ch == NULL) {
    printf("Could not mount fuse\n");
    return -3;
  }

  struct fuse *fuse = fuse_new(ch, &args, &ops, sizeof(struct fuse_operations), NULL);

  if (fuse == NULL) {
    printf("Could not instantiate fuse\n");
    return -4;
  }

  fuse_loop(fuse);
  fuse_unmount(mnt, ch);
  fuse_session_remove_chan(ch);
  fuse_destroy(fuse);

  printf("KTHXBYE\n");

  return 0;
}
