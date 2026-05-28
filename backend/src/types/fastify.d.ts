import "fastify";

declare module "fastify" {
	interface FastifyInstance {
		verifyAuth: (token: unknown) => boolean;
	}
}
