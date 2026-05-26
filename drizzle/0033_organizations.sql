CREATE TABLE `organizations` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nome` varchar(255) NOT NULL,
  `cnpj` varchar(18),
  `slug` varchar(100) NOT NULL,
  `esfera` enum('federal','estadual','municipal','outro') DEFAULT 'municipal',
  `uf` varchar(2),
  `municipio` varchar(100),
  `ativo` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  `updatedAt` timestamp NOT NULL DEFAULT now() ON UPDATE now(),
  UNIQUE KEY `organizations_cnpj_unique` (`cnpj`),
  UNIQUE KEY `organizations_slug_unique` (`slug`)
);

-- Organização padrão para dados existentes (id=1 garantido pelo AUTO_INCREMENT)
INSERT INTO `organizations` (`id`, `nome`, `slug`, `esfera`, `ativo`)
VALUES (1, 'Organização Padrão', 'default', 'municipal', true);
