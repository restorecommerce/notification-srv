FROM node:9.2.0-wheezy

# Create app directory
RUN mkdir -p /usr/share/notification-srv
RUN mkdir -p /root/.ssh
WORKDIR /usr/share/notification-srv

# Set config volumes
VOLUME /usr/share/notification-srv/cfg
VOLUME /usr/share/notification-srv/protos

# Bundle app source
COPY . /usr/share/notification-srv

# Install app dependencies
RUN npm install -g typescript

RUN cd /usr/share/notification-srv
COPY id_rsa /root/.ssh/
COPY config /root/.ssh/
COPY known_hosts /root/.ssh/

RUN npm install
RUN npm run postinstall

EXPOSE 50051
CMD [ "npm", "start" ]

# To build the image:
# docker build -t restorecommerce/notification-srv .
#
# To create a container:
# docker create --name notification-srv -v <absolute_path_to_cfg>/:/usr/share/notification-srv/cfg --net restorecommercedev_default restorecommerce/notification
#
# docker create --name notification-srv --net restorecms_default restorecommerce/notification-srv
#
# To run the container:
# docker start notification-srv
