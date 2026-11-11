# Copyright 2026 The PravahOS Authors. All rights reserved.
# Standalone & Cross-Compilation Makefile for pravahd native daemon

CC ?= $(CROSS_COMPILE)gcc
CFLAGS ?= -Wall -Wextra -O2 -std=c11 -D_GNU_SOURCE
LDFLAGS ?= -Wl,-z,relro,-z,now

SRC = pravahd.c
TARGET = pravahd

all: $(TARGET)

$(TARGET): $(SRC) pravahd.h
	$(CC) $(CFLAGS) $(SRC) -o $(TARGET) $(LDFLAGS)

clean:
	rm -f $(TARGET)

.PHONY: all clean
