{ pkgs, multiverse, ... }:
{
  devenv.warnOnNewVersion = false;
  dotenv = {
    enable = true;
    filename = ".env.development";
  };
  packages = with pkgs; [ git corepack postgresql_18 openssl ];
  languages.javascript = {
    enable = true;
    lsp.enable = false;
    package = multiverse.nodejs_26."26.12.1";
  };
}
