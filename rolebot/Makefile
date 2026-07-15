.PHONY: build run stop

build:
	docker build -t fluxer-rolebot .

run:
	mkdir -p data
	docker run --rm --env-file .env -v ./data:/app/data --name fluxer-rolebot fluxer-rolebot

stop:
	docker stop fluxer-rolebot
