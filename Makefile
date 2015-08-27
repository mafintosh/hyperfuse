DEPS_C = src/enc.c src/id_map.c src/socket.c
DEPS_H = src/enc.h src/id_map.h src/socket.h
FUSE_OPTS = $(shell pkg-config --libs-only-L --libs-only-l fuse --cflags-only-I)-D_FILE_OFFSET_BITS=64
CC = gcc -std=c99

all: hyperfuse

hyperfuse: $(DEPS_C) $(DEPS_H) src/hyperfuse.c
	$(CC) -O3 -pthread $(DEPS_C) src/hyperfuse.c $(FUSE_OPTS) -o $@

test: $(DEPS_C) $(DEPS_H) tests/*.c
	$(CC) $(DEPS_C) tests/*.c $(FUSE_OPTS) -o $@
	./$@

clean:
	rm -f test hyperfuse

.PHONY: test
