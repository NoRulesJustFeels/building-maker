docker-build:
	docker-compose -f docker-compose.building-maker.yml build

docker-up:
	docker-compose -f docker-compose.building-maker.yml up -d

docker-down:
	docker-compose -f docker-compose.building-maker.yml down -v

docker-logs:
	docker-compose -f docker-compose.building-maker.yml logs -f

docker-push:
	docker save -o building-maker-latest.tar building-maker:latest
	rsync building-maker-latest.tar docker-compose.building-maker.yml nginx.conf tz1and.com:/home/yves/docker
	ssh tz1and.com "source .profile; cd docker; docker load -i building-maker-latest.tar; mv nginx.conf nginx/conf/building-maker.conf"
	rm building-maker-latest.tar
