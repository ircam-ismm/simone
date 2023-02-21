#!/bin/bash

service="distributed-mosaicing-daemon.service"

echo "Stop \"$service\""
sudo systemctl stop "$service"
echo "Disable \"$service\""
sudo systemctl disable "$service"
sudo systemctl daemon-reload
